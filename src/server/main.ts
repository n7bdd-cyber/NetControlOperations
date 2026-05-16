/**
 * Project: NetControlOperations
 * File: main.ts
 * System Version: 1.0.0 | File Version: 10 | Date: 2026-05-15
 *   v10: S5-3 — getOthersSnapshot() for visitor band3 suffix-tap.
 *   v9: S5-2 UX — location list cap raised from 20 to 50.
 *   v8: S5-2 — getNcoLocations() + recordNcoLocation() for location autocomplete.
 *   v7: S5-1 — getNetTypes() + saveNetTypes() for Settings-driven net type dropdown.
 *   v6: Performance — roster + Others lookups in recordCheckin use findRowData()
 *       to eliminate the extra readRow() Sheets API call after findRowIndex().
 *   v5: Bug fix — dedup response in recordCheckin now returns the stored name
 *       from the Checkins row so callWithRetry retries don't lose the name.
 *   v4: Diagnostic — Logger.log added to recordCheckin roster name-lookup path.
 *   v3: Bug fix — roster callsign lookup in recordCheckin now trims whitespace,
 *       matching getRosterSnapshot behavior. Trailing spaces in Roster cells
 *       caused silent name-lookup miss and returned resolvedName: null.
 *   v2: S5-7 — reopenSession() added; 5-minute reopen window after endSession.
 *   v1: Initial version tracking. Slices 1–4 complete; seedDefaultRepeaters
 *       expanded with AllStar / IRLP / D-Star / DMR / YSF / Hamshack Hotline /
 *       Hams Over IP link-type placeholder rows.
 *
 * Description: Entry-point server functions bundled into dist/Code.gs by esbuild.
 *   doGet()                          — serves index.html via HtmlService
 *   startSession(input)              — opens a new Sessions row
 *   recordCheckin(input)             — records a check-in or increments tap count
 *   endSession(input)                — closes session, computes totals + hours
 *   reopenSession(input)             — reverses endSession within 5-minute window
 *   setupSheets()                    — creates / migrates sheet tabs + seeds data
 *   getRosterSnapshot()              — active roster entries for client-side cache
 *   resolveName(callsign, checkinId) — FCC callook lookup; writes name to Others + Checkins
 *   setManualName(callsign, id, name)— NCO-supplied name override
 *   reconcileOthersNames()           — backfills names from latest FCC results
 *   sundaySync()                     — scheduled weekly roster + callook sync
 *   installSundaySyncTrigger()       — registers the Sunday-midnight cron trigger
 *   getAdminStatus()                 — true if caller's email is in AdminEmails
 *   getTemplates()                   — all active NetTemplate rows
 *   getRepeaterSystems()             — active repeater systems grouped by name
 *   saveTemplate(input)              — create or update a NetTemplate row
 *   deleteTemplate(templateId)       — soft-deletes a template (sets DeletedAt)
 *   getNetTypes()                    — reads NET_TYPES from Settings; returns string[]
 *   saveNetTypes(types)              — admin-only; writes NET_TYPES to Settings
 *   getNcoLocations()                — reads NCO_LOCATIONS LRU list from Settings
 *   recordNcoLocation(location)      — prepends location to LRU list (fire-and-forget)
 *
 * Build: `npm run build` → esbuild bundles this + deps → dist/Code.gs.
 *        scripts/build.mjs hoists exports onto global for Apps Script.
 *
 * Teaching notes:
 *  - Discriminated unions: `Result = Success | Failure1 | Failure2 | ...`. We
 *    check `result.ok` and TypeScript narrows the type for us on each branch.
 *  - `as const` literals: `'INVALID_INPUT' as const` keeps TypeScript from
 *    widening the string to plain `string`, which would break the union match.
 *  - All write paths run inside `withLock(() => { ... })`. If the lock can't
 *    be acquired in 10 seconds, we return BUSY_TRY_AGAIN and the client retries.
 *  - `resolveName` is an exception: it must release the lock BEFORE the HTTP
 *    call to callook.info, then re-acquire for the write. Using `withLock`
 *    directly would hold the lock across network I/O — a deadlock risk under
 *    concurrent calls. So it manages the lock manually.
 */

import {
  CHECKINS_HEADERS,
  CheckinsCol,
  MAX_CREDITS,
  MAX_ID_FIELD,
  MAX_NAME,
  MAX_NCO_LOCATION,
  MAX_NCO_NAME,
  MAX_NET_TYPE,
  MAX_PREAMBLE,
  MAX_PURPOSE_NOTES,
  MAX_REPEATER,
  MAX_SECTION_CALL_TO_AIR,
  MAX_SECTION_NOTES,
  MAX_SECTION_TITLE,
  MAX_SECTIONS_PER_TEMPLATE,
  MAX_SYSTEM_NAME,
  MAX_TEMPLATE_NAME,
  OTHERS_HEADERS,
  OthersCol,
  PROP_ADMIN_EMAILS,
  PROP_CALLOOK_BASE_URL,
  PROP_ROSTER_CSV_DRIVE_FOLDER_ID,
  PROP_SPREADSHEET_ID,
  PROP_TRUSTEE_EMAIL,
  REPEATERS_HEADERS,
  RepeatersCol,
  ROSTER_HEADERS,
  RosterCol,
  SESSIONS_HEADERS,
  SETTINGS_HEADERS,
  SessionsCol,
  SESSION_STATUS_CLOSED,
  SESSION_STATUS_OPEN,
  SETTING_NCO_LOCATIONS,
  SETTING_NET_TYPES,
  SHEET_CHECKINS,
  SHEET_OTHERS,
  SHEET_REPEATERS,
  SHEET_ROSTER,
  SHEET_SESSIONS,
  SHEET_SETTINGS,
  SHEET_TEMPLATES,
  SOURCE_MANUAL,
  TEMPLATES_HEADERS,
  TemplatesCol,
  type DeleteTemplateResult,
  type EndSessionInput,
  type EndSessionResult,
  type GetRepeaterSystemsResult,
  type GetOthersSnapshotResult,
  type GetRosterSnapshotResult,
  type GetTemplatesResult,
  type NetTemplate,
  type ReconcileResult,
  type RecordCheckinInput,
  type RecordCheckinResult,
  type ReopenSessionInput,
  type ReopenSessionResult,
  type RepeaterEntry,
  type RepeaterSystem,
  type ResolveNameResult,
  type OtherEntry,
  type RosterEntry,
  type SaveNetTypesResult,
  type SaveTemplateInput,
  type SaveTemplateResult,
  type SetupSheetsResult,
  type StartSessionInput,
  type StartSessionResult,
  type TemplateSection,
} from './types';
import {
  appendRowAndGetIndex,
  findRowData,
  findRowIndex,
  getOrCreateSheetWithHeader,
  getSheetOrNull,
  getSpreadsheetOrNull,
  readRow,
  updateCells,
  withLock,
} from './sheets';
import { newUuid } from './ids';
import { nowIso } from './timestamps';
import {
  clampString,
  isValidCallsign,
  isValidIdField,
  isValidIsoDate,
  isValidIsoTime,
} from './validators';

// ---------------------------------------------------------------------------
// doGet — the web app entry point. Apps Script calls this on every HTTP GET.
// ---------------------------------------------------------------------------

export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) {
    return HtmlService.createHtmlOutput(
      '<p>App not configured &mdash; contact trustee.</p>',
    ).setTitle('NetControl');
  }
  return HtmlService.createHtmlOutputFromFile('index').setTitle('NetControl');
}

// ---------------------------------------------------------------------------
// startSession — FR-1.
// ---------------------------------------------------------------------------

export function startSession(input: StartSessionInput): StartSessionResult {
  // Step 0 (outside the lock): validate input.
  const validation = validateStartSessionInput(input);
  if (validation) return validation;

  // Step 1: acquire the lock and run the body.
  const result = withLock<StartSessionResult>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const sessions = getSheetOrNull(ss, SHEET_SESSIONS);
    if (!sessions) return { ok: false, error: 'NOT_CONFIGURED' as const };

    // Idempotency: if a row already has this requestId, return its sessionId.
    const dupRowIdx = findRowIndex(
      sessions,
      (row) => String(row[SessionsCol.RequestId]) === input.requestId,
    );
    if (dupRowIdx > 0) {
      const existingSessionId = String(readRow(sessions, dupRowIdx)[SessionsCol.SessionID]);
      return { ok: true, sessionId: existingSessionId, deduped: true };
    }

    // Build and append the new row.
    const sessionId = newUuid();
    const now = nowIso();
    const email = Session.getActiveUser().getEmail();
    const row = new Array(SESSIONS_HEADERS.length).fill('');
    row[SessionsCol.SessionID] = sessionId;
    row[SessionsCol.StartTimestamp] = now;
    row[SessionsCol.NetDate] = input.date;
    row[SessionsCol.NetTime] = input.time;
    row[SessionsCol.NetType] = clampString(input.netType, MAX_NET_TYPE);
    row[SessionsCol.NCOCallsign] = input.ncoCallsign;
    row[SessionsCol.NCOEmail] = email;
    row[SessionsCol.Repeater] = clampString(input.repeater, MAX_REPEATER);
    row[SessionsCol.PurposeNotes] = clampString(input.purposeNotes, MAX_PURPOSE_NOTES);
    row[SessionsCol.EndTimestamp] = '';
    row[SessionsCol.Status] = SESSION_STATUS_OPEN;
    row[SessionsCol.RequestId] = input.requestId;
    row[SessionsCol.NCOName] = clampString(input.ncoName, MAX_NCO_NAME);
    row[SessionsCol.NCOLocation] = clampString(input.ncoLocation, MAX_NCO_LOCATION);
    row[SessionsCol.RepeaterSystem] = clampString(input.repeaterSystem, MAX_SYSTEM_NAME);

    appendRowAndGetIndex(sessions, row);
    return { ok: true, sessionId, deduped: false };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

function validateStartSessionInput(input: StartSessionInput): StartSessionResult | null {
  if (!isValidIdField(input?.requestId, MAX_ID_FIELD)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'requestId', reason: 'must be a non-empty string ≤64 chars' };
  }
  if (!isValidIsoDate(input.date)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'date', reason: 'must be YYYY-MM-DD' };
  }
  if (!isValidIsoTime(input.time)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'time', reason: 'must be HH:mm 24h' };
  }
  if (typeof input.netType !== 'string' || input.netType.trim().length === 0) {
    return { ok: false, error: 'INVALID_INPUT', field: 'netType', reason: 'required' };
  }
  if (!isValidCallsign(input.ncoCallsign)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'ncoCallsign', reason: 'invalid callsign format' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// recordCheckin — FR-4.
// Slice 3 additions: Roster check, Others upsert, resolveAsync flag.
// The Others logic runs inside the existing withLock closure — no second lock.
// ---------------------------------------------------------------------------

export function recordCheckin(input: RecordCheckinInput): RecordCheckinResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'INVALID_INPUT', field: 'input', reason: 'required' };
  }
  if (!isValidIdField(input.sessionId, MAX_ID_FIELD)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'sessionId', reason: 'must be a non-empty string ≤64 chars' };
  }
  if (!isValidIdField(input.eventId, MAX_ID_FIELD)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'eventId', reason: 'must be a non-empty string ≤64 chars' };
  }
  if (!isValidCallsign(input.callsign)) {
    return { ok: false, error: 'INVALID_CALLSIGN' };
  }

  const result = withLock<RecordCheckinResult>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const sessions = getSheetOrNull(ss, SHEET_SESSIONS);
    const checkins = getSheetOrNull(ss, SHEET_CHECKINS);
    if (!sessions || !checkins) return { ok: false, error: 'NOT_CONFIGURED' as const };

    // Find the session.
    const sessionRowIdx = findRowIndex(
      sessions,
      (row) => String(row[SessionsCol.SessionID]) === input.sessionId,
    );
    if (sessionRowIdx < 0) return { ok: false, error: 'SESSION_NOT_FOUND' as const };

    const sessionRow = readRow(sessions, sessionRowIdx);
    if (String(sessionRow[SessionsCol.Status]) === SESSION_STATUS_CLOSED) {
      return { ok: false, error: 'SESSION_CLOSED' as const };
    }

    // Find existing checkin row for (sessionId, callsign).
    const existingRowIdx = findRowIndex(
      checkins,
      (row) =>
        String(row[CheckinsCol.SessionID]) === input.sessionId &&
        String(row[CheckinsCol.Callsign]) === input.callsign,
    );

    if (existingRowIdx > 0) {
      const existingRow = readRow(checkins, existingRowIdx);
      // Dedup check: same eventId → harmless retry.
      if (String(existingRow[CheckinsCol.LastTappedEventId]) === input.eventId) {
        return {
          ok: true,
          checkinId: String(existingRow[CheckinsCol.CheckinID]),
          firstEventForCallsignInSession: false,
          tapCount: Number(existingRow[CheckinsCol.TapCount]) || 0,
          deduped: true,
          resolveAsync: false,
          // Return the stored name so a retry that missed the first response can still show it.
          resolvedName: String(existingRow[CheckinsCol.Name] ?? '').trim() || null,
        };
      }
      // Genuine re-tap.
      const email = Session.getActiveUser().getEmail();
      const newTapCount = (Number(existingRow[CheckinsCol.TapCount]) || 0) + 1;
      updateCells(checkins, existingRowIdx, {
        [CheckinsCol.LatestTimestamp + 1]: nowIso(),
        [CheckinsCol.TapCount + 1]: newTapCount,
        [CheckinsCol.LastTappedByNCOEmail + 1]: email,
        [CheckinsCol.LastTappedEventId + 1]: input.eventId,
      });
      return {
        ok: true,
        checkinId: String(existingRow[CheckinsCol.CheckinID]),
        firstEventForCallsignInSession: false,
        tapCount: newTapCount,
        deduped: false,
        resolveAsync: false,
        resolvedName: null,
      };
    }

    // First-ever event for this callsign in this session.
    // Determine name: check Roster first, then Others cache.
    const now = nowIso();
    const email = Session.getActiveUser().getEmail();
    let resolvedName: string | null = null;
    let resolveAsync = false;

    const rosterSheet = getSheetOrNull(ss, SHEET_ROSTER);
    if (rosterSheet) {
      // findRowData returns the matching row in one getValues() call —
      // avoids a second readRow() API call after findRowIndex().
      const rosterRow = findRowData(
        rosterSheet,
        (row) => String(row[RosterCol.Callsign] ?? '').trim() === input.callsign,
      );
      if (rosterRow) {
        // Roster member: resolve name directly from Roster.
        const rosterName = String(rosterRow[RosterCol.Name] ?? '').trim();
        resolvedName = rosterName || null;
        // resolveAsync stays false — no FCC lookup needed for roster members.
      } else {
        // Not a roster member: check Others cache.
        resolveAsync = true;
        const othersSheet = getSheetOrNull(ss, SHEET_OTHERS);
        if (othersSheet) {
          const othersRowIdx = findRowIndex(
            othersSheet,
            (row) => String(row[OthersCol.Callsign]) === input.callsign,
          );
          if (othersRowIdx > 0) {
            const othersRow = readRow(othersSheet, othersRowIdx);
            const cachedName = String(othersRow[OthersCol.Name] ?? '').trim();
            if (cachedName) {
              resolvedName = cachedName;
              resolveAsync = false;
            }
            // Always bump LastActive on cache hit (name or not).
            updateCells(othersSheet, othersRowIdx, {
              [OthersCol.LastActive + 1]: now,
            });
          } else {
            // New callsign: create an Others row in 'pending' state.
            const othersRow = new Array(OTHERS_HEADERS.length).fill('');
            othersRow[OthersCol.Callsign] = input.callsign;
            othersRow[OthersCol.Source] = 'pending';
            othersRow[OthersCol.NameConflict] = false;
            othersRow[OthersCol.LastActive] = now;
            appendRowAndGetIndex(othersSheet, othersRow);
          }
        }
      }
    }

    // Build and append the Checkins row.
    const checkinId = newUuid();
    const row = new Array(CHECKINS_HEADERS.length).fill('');
    row[CheckinsCol.CheckinID] = checkinId;
    row[CheckinsCol.SessionID] = input.sessionId;
    row[CheckinsCol.Callsign] = input.callsign;
    row[CheckinsCol.FirstTimestamp] = now;
    row[CheckinsCol.LatestTimestamp] = now;
    row[CheckinsCol.TapCount] = 1;
    row[CheckinsCol.LoggedByNCOEmail] = email;
    row[CheckinsCol.Source] = SOURCE_MANUAL;
    row[CheckinsCol.LastTappedByNCOEmail] = email;
    row[CheckinsCol.LastTappedEventId] = input.eventId;
    row[CheckinsCol.Name] = resolvedName ?? '';

    appendRowAndGetIndex(checkins, row);
    return {
      ok: true,
      checkinId,
      firstEventForCallsignInSession: true,
      tapCount: 1,
      deduped: false,
      resolveAsync,
      resolvedName,
    };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// endSession — FR-9 (Sheet write half; MailApp deferred to a later slice).
// Slice 3 addition: purge Others rows where LastActive > 13 months ago.
// ---------------------------------------------------------------------------

export function endSession(input: EndSessionInput): EndSessionResult {
  if (!isValidIdField(input?.sessionId, MAX_ID_FIELD)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'sessionId', reason: 'must be a non-empty string ≤64 chars' };
  }

  const result = withLock<EndSessionResult>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const sessions = getSheetOrNull(ss, SHEET_SESSIONS);
    const checkins = getSheetOrNull(ss, SHEET_CHECKINS);
    if (!sessions || !checkins) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const sessionRowIdx = findRowIndex(
      sessions,
      (row) => String(row[SessionsCol.SessionID]) === input.sessionId,
    );
    if (sessionRowIdx < 0) return { ok: false, error: 'SESSION_NOT_FOUND' as const };

    // Tally Checkins for this session.
    const allCheckins = checkins.getDataRange().getValues();
    let checkinCount = 0;
    const callsigns = new Set<string>();
    for (let i = 1; i < allCheckins.length; i++) {
      const row = allCheckins[i];
      if (String(row[CheckinsCol.SessionID]) !== input.sessionId) continue;
      callsigns.add(String(row[CheckinsCol.Callsign]));
      checkinCount += Number(row[CheckinsCol.TapCount]) || 0;
    }
    const uniqueCallsignCount = callsigns.size;
    const hoursTotal = uniqueCallsignCount * 0.5;
    const spreadsheetUrl = ss.getUrl();

    const sessionRow = readRow(sessions, sessionRowIdx);
    if (String(sessionRow[SessionsCol.Status]) === SESSION_STATUS_CLOSED) {
      return {
        ok: true,
        checkinCount,
        uniqueCallsignCount,
        hoursTotal,
        spreadsheetUrl,
        alreadyClosed: true,
      };
    }

    // Close the session.
    updateCells(sessions, sessionRowIdx, {
      [SessionsCol.EndTimestamp + 1]: nowIso(),
      [SessionsCol.Status + 1]: SESSION_STATUS_CLOSED,
    });

    // Purge Others rows inactive for > 13 months. Delete bottom-to-top so
    // row indices don't shift under us mid-loop.
    const othersSheet = getSheetOrNull(ss, SHEET_OTHERS);
    if (othersSheet) {
      const purgeDate = new Date();
      purgeDate.setMonth(purgeDate.getMonth() - 13);
      const othersValues = othersSheet.getDataRange().getValues();
      let purgeCount = 0;
      for (let i = othersValues.length - 1; i >= 1; i--) {
        const lastActiveStr = String(othersValues[i][OthersCol.LastActive] ?? '');
        if (!lastActiveStr) continue;
        const lastActive = new Date(lastActiveStr);
        if (!isNaN(lastActive.getTime()) && lastActive < purgeDate) {
          othersSheet.deleteRow(i + 1); // convert 0-based to 1-based
          purgeCount++;
        }
      }
      if (purgeCount > 0) Logger.log(`endSession: purged ${purgeCount} stale Others rows`);
    }

    return {
      ok: true,
      checkinCount,
      uniqueCallsignCount,
      hoursTotal,
      spreadsheetUrl,
      alreadyClosed: false,
    };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// reopenSession — S5-7 "Oops" undo. Reverses endSession within 5 minutes.
// ---------------------------------------------------------------------------

export function reopenSession(input: ReopenSessionInput): ReopenSessionResult {
  if (!isValidIdField(input?.sessionId, MAX_ID_FIELD)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'sessionId', reason: 'must be a non-empty string ≤64 chars' };
  }

  const result = withLock<ReopenSessionResult>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const sessions = getSheetOrNull(ss, SHEET_SESSIONS);
    if (!sessions) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const sessionRowIdx = findRowIndex(
      sessions,
      (row) => String(row[SessionsCol.SessionID]) === input.sessionId,
    );
    if (sessionRowIdx < 0) return { ok: false, error: 'SESSION_NOT_FOUND' as const };

    const row = readRow(sessions, sessionRowIdx);
    if (String(row[SessionsCol.Status]) === SESSION_STATUS_OPEN) {
      return { ok: false, error: 'ALREADY_OPEN' as const };
    }

    const endTimestamp = String(row[SessionsCol.EndTimestamp] ?? '');
    const endMs = endTimestamp ? new Date(endTimestamp).getTime() : NaN;
    if (isNaN(endMs) || Date.now() - endMs > 300000) {
      return { ok: false, error: 'WINDOW_EXPIRED' as const };
    }

    updateCells(sessions, sessionRowIdx, {
      [SessionsCol.Status + 1]: SESSION_STATUS_OPEN,
      [SessionsCol.EndTimestamp + 1]: '',
    });
    return { ok: true };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// setupSheets — admin bootstrap. Creates all tabs idempotently.
// ---------------------------------------------------------------------------

export function setupSheets(): SetupSheetsResult {
  // Step 1 (outside the lock): admin check.
  const callerEmail = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const adminsRaw = PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_EMAILS) ?? '';
  const allowed = adminsRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (!callerEmail || !allowed.includes(callerEmail)) {
    return { ok: false, error: 'NOT_AUTHORIZED' };
  }

  // Step 2: acquire the lock and bootstrap tabs.
  const result = withLock<SetupSheetsResult>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const created: ('Sessions' | 'Checkins' | 'Roster' | 'Others' | 'Settings' | 'Templates' | 'Repeaters')[] = [];

    const sessions = getOrCreateSheetWithHeader(ss, SHEET_SESSIONS, SESSIONS_HEADERS);
    if (sessions.created) created.push('Sessions');

    // Slice 4 Sessions header migration: existing tabs may only have 12 columns.
    const sessionsHeaderLen = sessions.sheet.getRange(1, 1, 1, sessions.sheet.getLastColumn()).getValues()[0].length;
    if (sessionsHeaderLen < 15) {
      sessions.sheet.getRange(1, 13, 1, 3).setValues([['NCOName', 'NCOLocation', 'RepeaterSystem']]);
      sessions.sheet.setFrozenRows(1);
      Logger.log('setupSheets: migrated Sessions header to 15 columns');
    }

    const checkins = getOrCreateSheetWithHeader(ss, SHEET_CHECKINS, CHECKINS_HEADERS);
    if (checkins.created) created.push('Checkins');

    const roster = getOrCreateSheetWithHeader(ss, SHEET_ROSTER, ROSTER_HEADERS);
    if (roster.created) created.push('Roster');

    const others = getOrCreateSheetWithHeader(ss, SHEET_OTHERS, OTHERS_HEADERS);
    if (others.created) created.push('Others');

    const settings = getOrCreateSheetWithHeader(ss, SHEET_SETTINGS, SETTINGS_HEADERS);
    if (settings.created) created.push('Settings');

    // Slice 4: Templates tab.
    const templates = getOrCreateSheetWithHeader(ss, SHEET_TEMPLATES, TEMPLATES_HEADERS);
    if (templates.created) {
      created.push('Templates');
      seedDefaultTemplate(templates.sheet);
    }

    // Slice 4: Repeaters tab.
    const repeaters = getOrCreateSheetWithHeader(ss, SHEET_REPEATERS, REPEATERS_HEADERS);
    if (repeaters.created) {
      created.push('Repeaters');
      seedDefaultRepeaters(repeaters.sheet);
    } else {
      // Migration: existing Repeaters tabs (from dev iterations) may lack Description + ClosingCredit.
      const repHeaderLen = repeaters.sheet.getRange(1, 1, 1, repeaters.sheet.getLastColumn()).getValues()[0].length;
      if (repHeaderLen < 9) {
        repeaters.sheet.getRange(1, 8, 1, 2).setValues([['Description', 'ClosingCredit']]);
        repeaters.sheet.setFrozenRows(1);
        Logger.log('setupSheets: migrated Repeaters header to 9 columns');
      }
    }

    Logger.log(`setupSheets: created=${JSON.stringify(created)}`);
    Logger.log('setupSheets: REMINDER — getRepeaterSystems() has no auth gate; do not store non-published tactical data in the Repeaters tab if the web app is publicly accessible.');
    return { ok: true, created };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// getRosterSnapshot — FR-2 (narrower signature than the PRD spec).
// Read-only; no LockService. Slice 3: returns licenseClass, not lastActive.
// ---------------------------------------------------------------------------

export function getRosterSnapshot(): GetRosterSnapshotResult {
  const ss = getSpreadsheetOrNull();
  if (!ss) return { ok: false, error: 'NOT_CONFIGURED' };

  let sheet: GoogleAppsScript.Spreadsheet.Sheet | null;
  try {
    sheet = getSheetOrNull(ss, SHEET_ROSTER);
  } catch (e) {
    Logger.log(`getRosterSnapshot: getSheetByName threw: ${String(e)}`);
    return { ok: false, error: 'READ_FAILED' };
  }
  if (!sheet) return { ok: false, error: 'NOT_CONFIGURED' };

  let values: unknown[][];
  try {
    values = sheet.getDataRange().getValues();
  } catch (e) {
    Logger.log(`getRosterSnapshot: getValues threw: ${String(e)}`);
    return { ok: false, error: 'READ_FAILED' };
  }

  // Dedup by callsign: last-write-wins on row order.
  const seen = new Map<string, RosterEntry>();
  for (let i = 1; i < values.length; i++) {
    try {
      const row = values[i];
      const callsign = String(row[RosterCol.Callsign] ?? '').trim();
      if (!callsign) continue;
      if (!isValidCallsign(callsign)) {
        Logger.log(`getRosterSnapshot: skipping malformed row ${i}: ${callsign}`);
        continue;
      }
      const name = String(row[RosterCol.Name] ?? '').trim();
      const licenseClass = String(row[RosterCol.LicenseClass] ?? '').trim();
      seen.set(callsign, { callsign, name, licenseClass });
    } catch (e) {
      Logger.log(`getRosterSnapshot: row ${i} threw: ${String(e)}`);
    }
  }

  return { ok: true, roster: Array.from(seen.values()) };
}

// ---------------------------------------------------------------------------
// S5-3 — getOthersSnapshot: returns callsign+name for every row in the Others
// tab. Used by the client for band3 (visitor) suffix-tap candidates.
// Read-only; no LockService needed.
// ---------------------------------------------------------------------------

export function getOthersSnapshot(): GetOthersSnapshotResult {
  const ss = getSpreadsheetOrNull();
  if (!ss) return { ok: false, error: 'NOT_CONFIGURED' };

  let sheet: GoogleAppsScript.Spreadsheet.Sheet | null;
  try {
    sheet = getSheetOrNull(ss, SHEET_OTHERS);
  } catch (e) {
    Logger.log(`getOthersSnapshot: getSheetByName threw: ${String(e)}`);
    return { ok: false, error: 'READ_FAILED' };
  }
  if (!sheet) return { ok: false, error: 'NOT_CONFIGURED' };

  let values: unknown[][];
  try {
    values = sheet.getDataRange().getValues();
  } catch (e) {
    Logger.log(`getOthersSnapshot: getValues threw: ${String(e)}`);
    return { ok: false, error: 'READ_FAILED' };
  }

  const others: OtherEntry[] = [];
  for (let i = 1; i < values.length; i++) {
    try {
      const row = values[i];
      const callsign = String(row[OthersCol.Callsign] ?? '').trim();
      if (!callsign || !isValidCallsign(callsign)) continue;
      const name = String(row[OthersCol.Name] ?? '').trim();
      others.push({ callsign, name });
    } catch (e) {
      Logger.log(`getOthersSnapshot: row ${i} threw: ${String(e)}`);
    }
  }

  return { ok: true, others };
}

// ---------------------------------------------------------------------------
// resolveName — Slice 3 FR-6.
// Called from the client via google.script.run (async from client's view).
// Double-lock pattern: acquire → check cache → release → HTTP → re-acquire → write.
// ---------------------------------------------------------------------------

export function resolveName(callsign: string, checkinId: string): ResolveNameResult {
  const empty: ResolveNameResult = { callsign, checkinId, name: null, fccName: null };

  // Validate inputs before touching the lock.
  if (!isValidCallsign(callsign)) return empty;
  if (!isValidIdField(checkinId, MAX_ID_FIELD)) return empty;

  const ss = getSpreadsheetOrNull();
  if (!ss) return empty;

  const checkins = getSheetOrNull(ss, SHEET_CHECKINS);
  const others = getSheetOrNull(ss, SHEET_OTHERS);
  if (!checkins || !others) return empty;

  // IDOR guard: verify checkinId belongs to an open session and the callsign matches.
  const checkinRowIdx = findRowIndex(
    checkins,
    (row) => String(row[CheckinsCol.CheckinID]) === checkinId,
  );
  if (checkinRowIdx < 0) return empty;
  const checkinRow = readRow(checkins, checkinRowIdx);
  if (String(checkinRow[CheckinsCol.Callsign]) !== callsign) return empty;

  const sessionId = String(checkinRow[CheckinsCol.SessionID]);
  const sessions = getSheetOrNull(ss, SHEET_SESSIONS);
  if (!sessions) return empty;
  const sessionRowIdx = findRowIndex(
    sessions,
    (row) => String(row[SessionsCol.SessionID]) === sessionId,
  );
  if (sessionRowIdx < 0) return empty;
  const sessionRow = readRow(sessions, sessionRowIdx);
  if (String(sessionRow[SessionsCol.Status]) === SESSION_STATUS_CLOSED) return empty;

  // First lock: check Others cache. Release before HTTP call.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return empty;
  try {
    const othersRowIdx = findRowIndex(
      others,
      (row) => String(row[OthersCol.Callsign]) === callsign,
    );
    if (othersRowIdx > 0) {
      const othersRow = readRow(others, othersRowIdx);
      const cachedName = String(othersRow[OthersCol.Name] ?? '').trim();
      if (cachedName) {
        // Cache hit — write to Checkins and return without HTTP call.
        updateCells(checkins, checkinRowIdx, {
          [CheckinsCol.Name + 1]: cachedName,
        });
        const cachedFccName = String(othersRow[OthersCol.FccName] ?? '').trim() || null;
        return { callsign, checkinId, name: cachedName, fccName: cachedFccName };
      }
    }
    // No usable cache — fall through to HTTP call.
  } finally {
    lock.releaseLock();
  }

  // HTTP call to callook.info — OUTSIDE the lock.
  const baseUrl =
    PropertiesService.getScriptProperties().getProperty(PROP_CALLOOK_BASE_URL) ??
    'https://callook.info/';
  let fccName: string | null = null;
  let lookupOk = false;
  try {
    const response = UrlFetchApp.fetch(`${baseUrl}${callsign}/json`);
    const json = JSON.parse(response.getContentText()) as { status?: string; name?: string };
    if (json.status && json.status !== 'NOT_FOUND') {
      fccName = json.name ? String(json.name).trim() : null;
      lookupOk = true;
    }
  } catch {
    // Network error or parse failure → treat as NOT_FOUND.
    lookupOk = false;
  }

  // Second lock: write results.
  if (!lock.tryLock(10000)) return empty;
  try {
    const now = nowIso();
    const othersRowIdx = findRowIndex(
      others,
      (row) => String(row[OthersCol.Callsign]) === callsign,
    );

    if (lookupOk && fccName) {
      if (othersRowIdx > 0) {
        updateCells(others, othersRowIdx, {
          [OthersCol.FccName + 1]: fccName,
          [OthersCol.Name + 1]: fccName,
          [OthersCol.Source + 1]: 'fcc',
          [OthersCol.NameConflict + 1]: false,
          [OthersCol.LastActive + 1]: now,
        });
      } else {
        // Row doesn't exist yet (race: another call created it between checks).
        const othersRow = new Array(OTHERS_HEADERS.length).fill('');
        othersRow[OthersCol.Callsign] = callsign;
        othersRow[OthersCol.Name] = fccName;
        othersRow[OthersCol.FccName] = fccName;
        othersRow[OthersCol.Source] = 'fcc';
        othersRow[OthersCol.NameConflict] = false;
        othersRow[OthersCol.LastActive] = now;
        appendRowAndGetIndex(others, othersRow);
      }
      updateCells(checkins, checkinRowIdx, { [CheckinsCol.Name + 1]: fccName });
      return { callsign, checkinId, name: fccName, fccName };
    } else {
      // Lookup failed — upsert/update Others to keep LastActive fresh; preserve existing Name.
      if (othersRowIdx > 0) {
        updateCells(others, othersRowIdx, { [OthersCol.LastActive + 1]: now });
      } else {
        const othersRow = new Array(OTHERS_HEADERS.length).fill('');
        othersRow[OthersCol.Callsign] = callsign;
        othersRow[OthersCol.Source] = 'pending';
        othersRow[OthersCol.NameConflict] = false;
        othersRow[OthersCol.LastActive] = now;
        appendRowAndGetIndex(others, othersRow);
      }
      return empty;
    }
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// setManualName — Slice 3.
// Called from the client when the NCO taps "Check back" and types a name.
// ---------------------------------------------------------------------------

export function setManualName(callsign: string, checkinId: string, name: string): void {
  if (!isValidCallsign(callsign)) throw new Error('INVALID_CALLSIGN');
  if (!isValidIdField(checkinId, MAX_ID_FIELD)) throw new Error('INVALID_CHECKIN_ID');

  if (typeof name !== 'string') throw new Error('INVALID_NAME');
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('INVALID_NAME: empty');
  if (trimmed.length > MAX_NAME) throw new Error(`INVALID_NAME: exceeds ${MAX_NAME} chars`);
  // CSV-injection guard: reject strings that start with formula-trigger chars.
  if ('=+-@'.includes(trimmed[0])) throw new Error('INVALID_NAME: formula prefix');

  const ss = getSpreadsheetOrNull();
  if (!ss) throw new Error('NOT_CONFIGURED');

  const checkins = getSheetOrNull(ss, SHEET_CHECKINS);
  const others = getSheetOrNull(ss, SHEET_OTHERS);
  if (!checkins || !others) throw new Error('NOT_CONFIGURED');

  // IDOR guard.
  const checkinRowIdx = findRowIndex(
    checkins,
    (row) => String(row[CheckinsCol.CheckinID]) === checkinId,
  );
  if (checkinRowIdx < 0) throw new Error('CHECKIN_NOT_FOUND');
  const checkinRow = readRow(checkins, checkinRowIdx);
  if (String(checkinRow[CheckinsCol.Callsign]) !== callsign) throw new Error('CALLSIGN_MISMATCH');

  const sessionId = String(checkinRow[CheckinsCol.SessionID]);
  const sessions = getSheetOrNull(ss, SHEET_SESSIONS);
  if (!sessions) throw new Error('NOT_CONFIGURED');
  const sessionRowIdx = findRowIndex(
    sessions,
    (row) => String(row[SessionsCol.SessionID]) === sessionId,
  );
  if (sessionRowIdx < 0) throw new Error('SESSION_NOT_FOUND');
  const sessionRow = readRow(sessions, sessionRowIdx);
  if (String(sessionRow[SessionsCol.Status]) === SESSION_STATUS_CLOSED) {
    throw new Error('SESSION_CLOSED');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('BUSY_TRY_AGAIN');
  try {
    const now = nowIso();
    const othersRowIdx = findRowIndex(
      others,
      (row) => String(row[OthersCol.Callsign]) === callsign,
    );
    if (othersRowIdx > 0) {
      updateCells(others, othersRowIdx, {
        [OthersCol.Name + 1]: trimmed,
        [OthersCol.Source + 1]: 'manual',
        [OthersCol.LastActive + 1]: now,
      });
    } else {
      const othersRow = new Array(OTHERS_HEADERS.length).fill('');
      othersRow[OthersCol.Callsign] = callsign;
      othersRow[OthersCol.Name] = trimmed;
      othersRow[OthersCol.Source] = 'manual';
      othersRow[OthersCol.NameConflict] = false;
      othersRow[OthersCol.LastActive] = now;
      appendRowAndGetIndex(others, othersRow);
    }
    updateCells(checkins, checkinRowIdx, { [CheckinsCol.Name + 1]: trimmed });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// reconcileOthersNames — batch FCC lookup for pending/manual Others rows.
// Also called as the last step of sundaySync (intentionally outside that
// function's lock — Roster is fully settled before reconciliation begins).
// ---------------------------------------------------------------------------

export function reconcileOthersNames(): ReconcileResult {
  const result: ReconcileResult = {
    checked: 0,
    silentlyResolved: 0,
    conflicts: 0,
    skipped: 0,
    timedOut: false,
    remaining: 0,
  };

  const ss = getSpreadsheetOrNull();
  if (!ss) return result;

  const others = getSheetOrNull(ss, SHEET_OTHERS);
  if (!others) return result;

  // Read all Others rows that need processing (outside the lock — read-only).
  const allValues = others.getDataRange().getValues();
  const toProcess: { rowIdx: number; callsign: string }[] = [];
  for (let i = 1; i < allValues.length; i++) {
    const row = allValues[i];
    const source = String(row[OthersCol.Source] ?? '');
    const nameConflict = row[OthersCol.NameConflict];
    // Skip rows already flagged as conflicted — trustee has been notified.
    if (nameConflict === true || String(nameConflict).toUpperCase() === 'TRUE') {
      result.skipped++;
      continue;
    }
    if (source === 'pending' || source === 'manual') {
      const callsign = String(row[OthersCol.Callsign] ?? '').trim();
      if (callsign) toProcess.push({ rowIdx: i + 1, callsign }); // 1-based
    }
  }

  const baseUrl =
    PropertiesService.getScriptProperties().getProperty(PROP_CALLOOK_BASE_URL) ??
    'https://callook.info/';
  const startTime = Date.now();

  for (let idx = 0; idx < toProcess.length; idx++) {
    // Time-budget check: stop at 270 s to stay under the 6-minute limit.
    if (Date.now() - startTime > 270_000) {
      result.timedOut = true;
      result.remaining = toProcess.length - idx;
      break;
    }
    if (idx > 0) Utilities.sleep(500); // callook.info rate courtesy

    const { rowIdx, callsign } = toProcess[idx];
    result.checked++;

    let fccName: string | null = null;
    let lookupOk = false;
    try {
      const response = UrlFetchApp.fetch(`${baseUrl}${callsign}/json`);
      const json = JSON.parse(response.getContentText()) as { status?: string; name?: string };
      if (json.status && json.status !== 'NOT_FOUND') {
        fccName = json.name ? String(json.name).trim() : null;
        lookupOk = true;
      }
    } catch {
      lookupOk = false;
    }

    if (!lookupOk || !fccName) continue; // retry next Sunday

    // Per-row write lock.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) continue; // skip this row if contended
    try {
      const now = nowIso();
      // Re-read the row inside the lock for a consistent view.
      const currentRow = readRow(others, rowIdx);
      const currentName = String(currentRow[OthersCol.Name] ?? '').trim();

      if (!currentName) {
        // Blank name → silent resolve.
        updateCells(others, rowIdx, {
          [OthersCol.Name + 1]: fccName,
          [OthersCol.FccName + 1]: fccName,
          [OthersCol.Source + 1]: 'fcc',
          [OthersCol.NameConflict + 1]: false,
          [OthersCol.LastActive + 1]: now,
        });
        result.silentlyResolved++;
      } else if (currentName.toLowerCase() === fccName.toLowerCase()) {
        // Name matches FCC — silent confirm.
        updateCells(others, rowIdx, {
          [OthersCol.FccName + 1]: fccName,
          [OthersCol.Source + 1]: 'fcc',
          [OthersCol.NameConflict + 1]: false,
          [OthersCol.LastActive + 1]: now,
        });
        result.silentlyResolved++;
      } else {
        // Conflict: manual name differs from FCC name.
        updateCells(others, rowIdx, {
          [OthersCol.FccName + 1]: fccName,
          [OthersCol.NameConflict + 1]: true,
          [OthersCol.LastActive + 1]: now,
        });
        result.conflicts++;
      }
    } finally {
      lock.releaseLock();
    }
  }

  // After batch: send trustee digest if there are conflicts or a timeout.
  const allValuesAfter = others.getDataRange().getValues();
  const conflictRows: { callsign: string; name: string; fccName: string }[] = [];
  for (let i = 1; i < allValuesAfter.length; i++) {
    const row = allValuesAfter[i];
    const nc = row[OthersCol.NameConflict];
    if (nc === true || String(nc).toUpperCase() === 'TRUE') {
      conflictRows.push({
        callsign: String(row[OthersCol.Callsign] ?? ''),
        name: String(row[OthersCol.Name] ?? ''),
        fccName: String(row[OthersCol.FccName] ?? ''),
      });
    }
  }

  if (conflictRows.length > 0 || result.timedOut) {
    const trusteeEmail = PropertiesService.getScriptProperties().getProperty(PROP_TRUSTEE_EMAIL);
    if (trusteeEmail) {
      const rows = conflictRows
        .map((r) => `  ${r.callsign}: heard "${r.name}" / FCC "${r.fccName}"`)
        .join('\n');
      let body = `reconcileOthersNames found ${conflictRows.length} name conflict(s):\n\n${rows}`;
      if (result.timedOut) {
        body += `\n\nReconciliation timed out with ${result.remaining} rows not yet processed.`;
        body += `\nTo continue: Apps Script editor → run reconcileOthersNames from the run-dropdown.`;
      }
      MailApp.sendEmail(trusteeEmail, 'WashCoARES NCO App — Name Conflicts', body);
    }
  }

  Logger.log(`reconcileOthersNames: ${JSON.stringify(result)}`);
  return result;
}

// ---------------------------------------------------------------------------
// sundaySync — weekly trigger to replace the Roster from the ActivARES CSV.
// ---------------------------------------------------------------------------

export function sundaySync(): void {
  // Idempotency guard: a concurrent manual run exits cleanly if the lock is held.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('sundaySync: lock unavailable — another execution is running');
    return;
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const folderId = props.getProperty(PROP_ROSTER_CSV_DRIVE_FOLDER_ID);
    const trusteeEmail = props.getProperty(PROP_TRUSTEE_EMAIL);

    if (!folderId) {
      Logger.log('sundaySync: RosterCsvDriveFolderId not configured');
      return;
    }

    const ss = getSpreadsheetOrNull();
    if (!ss) {
      Logger.log('sundaySync: Spreadsheet not configured');
      return;
    }

    const rosterSheet = getSheetOrNull(ss, SHEET_ROSTER);
    if (!rosterSheet) {
      Logger.log('sundaySync: Roster tab missing — run setupSheets first');
      return;
    }

    // Find the newest file in the Drive folder.
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    let newestFile: GoogleAppsScript.Drive.File | null = null;
    let newestTime = 0;
    while (files.hasNext()) {
      const f = files.next();
      // Skip Google-native formats (Sites, Docs, Sheets, etc.) — only uploaded files are valid.
      if (f.getMimeType().startsWith('application/vnd.google-apps')) continue;
      const t = (f.getLastUpdated() as unknown as Date).getTime();
      if (t > newestTime) {
        newestTime = t;
        newestFile = f;
      }
    }

    if (!newestFile) {
      Logger.log('sundaySync: no files found in roster folder');
      return;
    }

    const csvText = DriveApp.getFileById(newestFile.getId()).getBlob().getDataAsString();
    const rows = Utilities.parseCsv(csvText) as string[][];

    if (rows.length === 0) {
      Logger.log('sundaySync: CSV is empty');
      if (trusteeEmail) MailApp.sendEmail(trusteeEmail, 'WashCoARES NCO App — Roster Sync Failed', 'CSV file is empty.');
      return;
    }

    // Validate header row contains the required columns.
    const header = rows[0].map((h: string) => h.trim());
    const requiredCols = ['Callsign', 'Name', 'LicenseClass'];
    const missing = requiredCols.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      const msg = `sundaySync: CSV header missing columns: ${missing.join(', ')}`;
      Logger.log(msg);
      if (trusteeEmail) MailApp.sendEmail(trusteeEmail, 'WashCoARES NCO App — Roster Sync Failed', msg);
      return;
    }

    const callsignIdx = header.indexOf('Callsign');
    const nameIdx = header.indexOf('Name');
    const licenseClassIdx = header.indexOf('LicenseClass');

    // Replace Roster data rows (keep frozen header). Clear + batch write.
    const lastRow = rosterSheet.getLastRow();
    if (lastRow > 1) {
      rosterSheet.getRange(2, 1, lastRow - 1, ROSTER_HEADERS.length).clearContent();
    }

    const dataRows = rows.slice(1).filter((r: string[]) => r.some((c) => c.trim().length > 0));
    for (const dataRow of dataRows) {
      const newRow = new Array(ROSTER_HEADERS.length).fill('');
      newRow[RosterCol.Callsign] = String(dataRow[callsignIdx] ?? '').trim();
      newRow[RosterCol.Name] = String(dataRow[nameIdx] ?? '').trim();
      newRow[RosterCol.LicenseClass] = String(dataRow[licenseClassIdx] ?? '').trim();
      rosterSheet.appendRow(newRow);
    }

    Logger.log(`sundaySync: loaded ${dataRows.length} roster rows`);
  } finally {
    lock.releaseLock();
  }

  // Reconcile Others names OUTSIDE the lock — Roster is settled.
  reconcileOthersNames();
}

// ---------------------------------------------------------------------------
// installSundaySyncTrigger — run once from the Apps Script run-dropdown.
// Deduplicates: deletes any existing sundaySync trigger before installing.
// ---------------------------------------------------------------------------

export function installSundaySyncTrigger(): void {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sundaySync')
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('sundaySync')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2) // fires 02:00–03:00 PT; CSV expected by 01:30 PT
    .create();
}

// ---------------------------------------------------------------------------
// Slice 4 — Template and Repeater seed helpers (called from setupSheets).
// ---------------------------------------------------------------------------

function seedDefaultTemplate(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  const now = nowIso();

  const sections: TemplateSection[] = [
    { id: Utilities.getUuid(), title: 'A through D',     callToAir: 'Alpha through Delta — please call now.',                                                 notes: '',                                                                                                                                          order: 1 },
    { id: Utilities.getUuid(), title: 'E through H',     callToAir: 'Echo through Hotel — please call now.',                                                  notes: '',                                                                                                                                          order: 2 },
    { id: Utilities.getUuid(), title: 'I through L',     callToAir: 'India through Lima — please call now.',                                                  notes: '',                                                                                                                                          order: 3 },
    { id: Utilities.getUuid(), title: 'M through R',     callToAir: 'Mike through Romeo — please call now.',                                                  notes: '',                                                                                                                                          order: 4 },
    { id: Utilities.getUuid(), title: 'S through Z',     callToAir: 'Sierra through Zulu — please call now.',                                                 notes: '',                                                                                                                                          order: 5 },
    { id: Utilities.getUuid(), title: 'Late or Missed',  callToAir: 'Are there any late or missed ARES member check-ins?',                                    notes: '',                                                                                                                                          order: 6 },
    { id: Utilities.getUuid(), title: 'Visitors',        callToAir: 'Are there any visitor check-ins for the Washington County ARES net this evening?',       notes: 'Ask for call, name, location, and any ARES or ARRL position.',                                                                              order: 7 },
    { id: Utilities.getUuid(), title: 'Announcements',   callToAir: 'The net should be aware of the following upcoming ARES events.',                         notes: 'Announce events from the WashCoARES website calendar for the next two weeks. Read any QSTs submitted by the EC.',                          order: 8 },
    { id: Utilities.getUuid(), title: 'Business',        callToAir: 'Is there any other business, questions, or discussion for the net?',                     notes: '',                                                                                                                                          order: 9 },
    { id: Utilities.getUuid(), title: 'Last Call',       callToAir: 'Last call for late or missed member or visitor check-ins.',                              notes: '',                                                                                                                                          order: 10 },
  ];

  const preamble =
    'Good evening. This is {{ncoCallsign}}, your net control station for this session of the Washington County Amateur Radio Emergency Service Net. This is a directed net. Those stations checking into the net are expected to monitor unless they request to be excused.\n\n' +
    'Regular sessions of this net meet Tuesdays at 7 p.m. local time except for meeting night, which is the third Tuesday of each month. This net is sanctioned to meet on the {{primaryDescription}} {{primaryFrequency}} repeater with a {{primaryPlTone}} tone which is our primary Net frequency. Our alternate frequency is the {{alternateFrequency}} repeater with a {{alternatePlTone}} tone.\n\n' +
    'Please refrain from using the word break unless you have a bona-fide emergency. Stations using the word break will be assumed to be indicating an emergency transmission.\n\n' +
    'All stations standby for net check in. Check-ins will be in alphabetical order of call sign suffixes. Visitor check-ins will occur after the regular member check-ins. This is {{ncoCallsign}}, located in {{ncoLocation}}, and my name is {{ncoName}}. The net is now open for check-ins.';

  const credits =
    'This is {{ncoCallsign}}, your net control for this session of the Washington County Amateur Radio Emergency Service Net.\n\n' +
    '{{repeaterCredit}} I also thank everyone who has participated in the net this evening. This session of the Washington County ARES Net is now closed, and the frequency is now open for regular traffic. 73 everyone. {{ncoCallsign}} clear.';

  const row = new Array(TEMPLATES_HEADERS.length).fill('');
  row[TemplatesCol.TemplateId]   = Utilities.getUuid();
  row[TemplatesCol.Name]         = 'WashCoARES Weekly Net';
  row[TemplatesCol.Preamble]     = preamble;
  row[TemplatesCol.SectionsJson] = JSON.stringify(sections);
  row[TemplatesCol.Credits]      = credits;
  row[TemplatesCol.IsDefault]    = true;
  row[TemplatesCol.CreatedAt]    = now;
  row[TemplatesCol.UpdatedAt]    = now;
  row[TemplatesCol.UpdatedBy]    = Session.getActiveUser().getEmail();
  row[TemplatesCol.DeletedAt]    = '';
  sheet.appendRow(row);
}

function seedDefaultRepeaters(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  const washCoRows: unknown[][] = [
    ['WashCoARES', 'WORC',     '145.450 MHz', '107.2 Hz', 'primary',   1, true,  'Western Oregon Radio Club, Inc.',             'We thank the Western Oregon Radio Club, Inc. for the use of the 145.450 MHz repeater.'],
    ['WashCoARES', 'Wes Allen','440.350 MHz', '127.3 Hz', 'alternate', 2, true,  'Family of Wes Allen, silent key',             'We thank the family of Wes Allen, silent key, for the use of the 440.350 MHz repeater.'],
    ['WashCoARES', 'WCARC',    '147.360 MHz', '',         'alternate', 3, true,  'Washington County Amateur Radio Corporation', 'We thank the Washington County Amateur Radio Corporation for the use of the 147.360 MHz repeater.'],
  ];
  const d1Rows: unknown[][] = [
    ['Oregon ARES D1', '(trustee fills)', '147.320 MHz', '100.0 Hz', 'linked',    1, false, '', ''],
    ['Oregon ARES D1', '(trustee fills)', '442.325 MHz', '100.0 Hz', 'linked',    2, false, '', ''],
    ['Oregon ARES D1', '(trustee fills)', '444.400 MHz', '100.0 Hz', 'linked',    3, false, '', ''],
    ['Oregon ARES D1', '(trustee fills)', '147.040 MHz', '100.0 Hz', 'linked',    4, false, '', ''],
    ['Oregon ARES D1', '(trustee fills)', '146.720 MHz', '114.8 Hz', 'linked',    5, false, 'Wikiup Mountain', ''],
    ['Oregon ARES D1', '(trustee fills)', '146.840 MHz', '',         'alternate', 6, false, '', ''],
    ['Oregon ARES D1', 'K7RPT-L',         '',            '',         'EchoLink',         7,  false, 'K7RPT-L repeater connection',       ''],
    ['Oregon ARES D1', '(trustee fills)', '',            '',         'AllStar',          8,  false, 'AllStar node number',               ''],
    ['Oregon ARES D1', '(trustee fills)', '',            '',         'IRLP',             9,  false, 'IRLP node number',                  ''],
    ['Oregon ARES D1', '(trustee fills)', '',            '',         'D-Star',           10, false, 'D-Star reflector and module',       ''],
    ['Oregon ARES D1', '(trustee fills)', '',            '',         'DMR',              11, false, 'DMR talkgroup ID',                  ''],
    ['Oregon ARES D1', '(trustee fills)', '',            '',         'YSF',              12, false, 'Yaesu System Fusion room',          ''],
    ['Oregon ARES D1', '(trustee fills)', '',            '',         'Hamshack Hotline', 13, false, 'Hamshack Hotline extension number', ''],
    ['Oregon ARES D1', '(trustee fills)', '',            '',         'Hams Over IP',     14, false, 'Hams Over IP extension or address', ''],
  ];
  [...washCoRows, ...d1Rows].forEach((r) => sheet.appendRow(r as unknown[]));
}

// ---------------------------------------------------------------------------
// Slice 4 — getAdminStatus: client calls this to determine editor visibility.
// ---------------------------------------------------------------------------

export function getAdminStatus(): boolean {
  const callerEmail = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!callerEmail) return false;
  const adminsRaw = PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_EMAILS) ?? '';
  const allowed = adminsRaw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  return allowed.includes(callerEmail);
}

// ---------------------------------------------------------------------------
// Slice 4 — getTemplates: returns all non-deleted templates, sorted by Name.
// ---------------------------------------------------------------------------

export function getTemplates(): GetTemplatesResult {
  const ss = getSpreadsheetOrNull();
  if (!ss) return { ok: false, error: 'NOT_CONFIGURED' };

  let sheet: GoogleAppsScript.Spreadsheet.Sheet | null;
  try {
    sheet = getSheetOrNull(ss, SHEET_TEMPLATES);
  } catch (e) {
    Logger.log(`getTemplates: getSheetByName threw: ${String(e)}`);
    return { ok: false, error: 'READ_FAILED' };
  }
  if (!sheet) return { ok: false, error: 'NOT_CONFIGURED' };

  let values: unknown[][];
  try {
    values = sheet.getDataRange().getValues();
  } catch (e) {
    Logger.log(`getTemplates: getValues threw: ${String(e)}`);
    return { ok: false, error: 'READ_FAILED' };
  }

  const templates: NetTemplate[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const deletedAt = String(row[TemplatesCol.DeletedAt] ?? '').trim();
    if (deletedAt) continue; // soft-deleted

    let sections: TemplateSection[] = [];
    let sectionsParseError = false;
    const sectionsJson = String(row[TemplatesCol.SectionsJson] ?? '').trim();
    if (sectionsJson) {
      try {
        const parsed = JSON.parse(sectionsJson);
        if (Array.isArray(parsed)) {
          sections = parsed as TemplateSection[];
        } else {
          sectionsParseError = true;
        }
      } catch {
        sectionsParseError = true;
      }
    }

    const isDefaultRaw = row[TemplatesCol.IsDefault];
    const isDefault = isDefaultRaw === true || String(isDefaultRaw).toUpperCase() === 'TRUE';

    templates.push({
      templateId:         String(row[TemplatesCol.TemplateId] ?? ''),
      name:               String(row[TemplatesCol.Name] ?? ''),
      preamble:           String(row[TemplatesCol.Preamble] ?? ''),
      sections,
      credits:            String(row[TemplatesCol.Credits] ?? ''),
      isDefault,
      createdAt:          String(row[TemplatesCol.CreatedAt] ?? ''),
      updatedAt:          String(row[TemplatesCol.UpdatedAt] ?? ''),
      updatedBy:          String(row[TemplatesCol.UpdatedBy] ?? ''),
      deletedAt:          '',
      ...(sectionsParseError ? { sectionsParseError: true } : {}),
    });
  }

  // Sort: Name ascending; tiebreaker: createdAt ascending.
  templates.sort((a, b) => {
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return { ok: true, templates };
}

// ---------------------------------------------------------------------------
// Slice 4 — getRepeaterSystems: returns all active systems grouped and sorted.
// ---------------------------------------------------------------------------

export function getRepeaterSystems(): GetRepeaterSystemsResult {
  const ss = getSpreadsheetOrNull();
  if (!ss) return { ok: false, error: 'NOT_CONFIGURED' };

  let sheet: GoogleAppsScript.Spreadsheet.Sheet | null;
  try {
    sheet = getSheetOrNull(ss, SHEET_REPEATERS);
  } catch (e) {
    Logger.log(`getRepeaterSystems: getSheetByName threw: ${String(e)}`);
    return { ok: false, error: 'READ_FAILED' };
  }
  if (!sheet) return { ok: false, error: 'NOT_CONFIGURED' };

  let values: unknown[][];
  try {
    values = sheet.getDataRange().getValues();
  } catch (e) {
    Logger.log(`getRepeaterSystems: getValues threw: ${String(e)}`);
    return { ok: false, error: 'READ_FAILED' };
  }

  const systemMap = new Map<string, RepeaterSystem>();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const isActiveRaw = row[RepeatersCol.IsActive];
    const isActive = isActiveRaw === true || String(isActiveRaw).toUpperCase() === 'TRUE';
    if (!isActive) continue;

    const entry: RepeaterEntry = {
      systemName:    String(row[RepeatersCol.SystemName]   ?? '').trim(),
      repeaterName:  String(row[RepeatersCol.RepeaterName] ?? '').trim(),
      frequency:     String(row[RepeatersCol.Frequency]    ?? '').trim(),
      plTone:        String(row[RepeatersCol.PlTone]       ?? '').trim(),
      type:          String(row[RepeatersCol.Type]         ?? '').trim(),
      displayOrder:  Number(row[RepeatersCol.DisplayOrder]) || 0,
      isActive:      true,
      description:   String(row[RepeatersCol.Description]  ?? '').trim(),
      closingCredit: String(row[RepeatersCol.ClosingCredit]?? '').trim(),
    };
    if (!entry.systemName) continue;

    if (!systemMap.has(entry.systemName)) {
      systemMap.set(entry.systemName, { name: entry.systemName, primary: [], linked: [], alternate: [], links: [] });
    }
    const sys = systemMap.get(entry.systemName)!;

    const typeLower = entry.type.toLowerCase();
    if (typeLower === 'primary')   sys.primary.push(entry);
    else if (typeLower === 'linked')    sys.linked.push(entry);
    else if (typeLower === 'alternate') sys.alternate.push(entry);
    else                                sys.links.push(entry);
  }

  // Sort entries within each system by displayOrder; sort systems alphabetically.
  const byOrder = (a: RepeaterEntry, b: RepeaterEntry) => a.displayOrder - b.displayOrder;
  const systems: RepeaterSystem[] = [];
  for (const sys of systemMap.values()) {
    sys.primary.sort(byOrder);
    sys.linked.sort(byOrder);
    sys.alternate.sort(byOrder);
    sys.links.sort(byOrder);
    systems.push(sys);
  }
  systems.sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, systems };
}

// ---------------------------------------------------------------------------
// Slice 4 — saveTemplate: admin-only upsert.
// ---------------------------------------------------------------------------

export function saveTemplate(input: SaveTemplateInput): SaveTemplateResult {
  // Step 1: caller check (outside the lock — no I/O needed).
  const callerEmail = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!callerEmail) return { ok: false, error: 'NOT_AUTHORIZED' };
  const adminsRaw = PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_EMAILS) ?? '';
  const allowed = adminsRaw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  if (!allowed.includes(callerEmail)) return { ok: false, error: 'NOT_AUTHORIZED' };

  // Step 2: validate input.
  const t = input?.template;
  if (!t) return { ok: false, error: 'INVALID_INPUT', field: 'template', reason: 'required' };
  if (!t.templateId || t.templateId.length > MAX_ID_FIELD)
    return { ok: false, error: 'INVALID_INPUT', field: 'templateId', reason: `required, max ${MAX_ID_FIELD} chars` };
  if (!t.name || t.name.trim().length === 0 || t.name.length > MAX_TEMPLATE_NAME)
    return { ok: false, error: 'INVALID_INPUT', field: 'name', reason: `required, max ${MAX_TEMPLATE_NAME} chars` };
  if (typeof t.preamble !== 'string' || t.preamble.length > MAX_PREAMBLE)
    return { ok: false, error: 'INVALID_INPUT', field: 'preamble', reason: `max ${MAX_PREAMBLE} chars` };
  if (typeof t.credits !== 'string' || t.credits.length > MAX_CREDITS)
    return { ok: false, error: 'INVALID_INPUT', field: 'credits', reason: `max ${MAX_CREDITS} chars` };
  if (!Array.isArray(t.sections) || t.sections.length > MAX_SECTIONS_PER_TEMPLATE)
    return { ok: false, error: 'INVALID_INPUT', field: 'sections', reason: `max ${MAX_SECTIONS_PER_TEMPLATE} sections` };

  const sectionIds = new Set<string>();
  const sectionOrders = new Set<number>();
  for (const s of t.sections) {
    if (!s.id) return { ok: false, error: 'INVALID_INPUT', field: 'sections', reason: 'each section requires an id' };
    if (sectionIds.has(s.id)) return { ok: false, error: 'INVALID_INPUT', field: 'sections', reason: 'duplicate section id' };
    sectionIds.add(s.id);
    if (typeof s.title !== 'string' || s.title.length > MAX_SECTION_TITLE)
      return { ok: false, error: 'INVALID_INPUT', field: 'sections', reason: `section title max ${MAX_SECTION_TITLE} chars` };
    if (typeof s.callToAir !== 'string' || s.callToAir.length > MAX_SECTION_CALL_TO_AIR)
      return { ok: false, error: 'INVALID_INPUT', field: 'sections', reason: `section callToAir max ${MAX_SECTION_CALL_TO_AIR} chars` };
    if (typeof s.notes !== 'string' || s.notes.length > MAX_SECTION_NOTES)
      return { ok: false, error: 'INVALID_INPUT', field: 'sections', reason: `section notes max ${MAX_SECTION_NOTES} chars` };
    if (!Number.isInteger(s.order) || s.order < 1)
      return { ok: false, error: 'INVALID_INPUT', field: 'sections', reason: 'section order must be a positive integer' };
    if (sectionOrders.has(s.order)) return { ok: false, error: 'INVALID_INPUT', field: 'sections', reason: 'duplicate section order' };
    sectionOrders.add(s.order);
  }

  // Step 3: acquire lock.
  const result = withLock<SaveTemplateResult>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return { ok: false, error: 'NOT_CONFIGURED' as const };
    const sheet = getSheetOrNull(ss, SHEET_TEMPLATES);
    if (!sheet) return { ok: false, error: 'NOT_CONFIGURED' as const };

    // Step 4: load all rows.
    const allValues = sheet.getDataRange().getValues();

    // Step 5: detect create vs. update; block recycling of soft-deleted IDs.
    let activeRowIdx = -1;
    let softDeletedExists = false;
    for (let i = 1; i < allValues.length; i++) {
      const rowId = String(allValues[i][TemplatesCol.TemplateId] ?? '');
      if (rowId !== t.templateId) continue;
      const deletedAt = String(allValues[i][TemplatesCol.DeletedAt] ?? '').trim();
      if (deletedAt) { softDeletedExists = true; } else { activeRowIdx = i + 1; } // 1-based
    }
    if (softDeletedExists && activeRowIdx < 0) {
      return { ok: false, error: 'INVALID_INPUT', field: 'templateId', reason: 'ID belongs to a deleted template; generate a new UUID' };
    }
    const isCreate = activeRowIdx < 0;

    // Step 6: IsDefault enforcement.
    if (t.isDefault) {
      // Clear IsDefault on all other non-deleted rows.
      for (let i = 1; i < allValues.length; i++) {
        const rowId = String(allValues[i][TemplatesCol.TemplateId] ?? '');
        const deletedAt = String(allValues[i][TemplatesCol.DeletedAt] ?? '').trim();
        if (deletedAt || rowId === t.templateId) continue;
        const curDefault = allValues[i][TemplatesCol.IsDefault];
        if (curDefault === true || String(curDefault).toUpperCase() === 'TRUE') {
          updateCells(sheet, i + 1, { [TemplatesCol.IsDefault + 1]: false });
        }
      }
    } else {
      // Guard: cannot leave the store with no default.
      if (!isCreate) {
        // Update path: check if this row currently IS the default and no other is.
        const curDefault = allValues[activeRowIdx - 1][TemplatesCol.IsDefault];
        if (curDefault === true || String(curDefault).toUpperCase() === 'TRUE') {
          const otherDefault = allValues.slice(1).some((r, _idx) => {
            const rid = String(r[TemplatesCol.TemplateId] ?? '');
            const del = String(r[TemplatesCol.DeletedAt] ?? '').trim();
            const def = r[TemplatesCol.IsDefault];
            return rid !== t.templateId && !del && (def === true || String(def).toUpperCase() === 'TRUE');
          });
          if (!otherDefault) {
            return { ok: false, error: 'INVALID_INPUT', field: 'isDefault', reason: 'Cannot remove the default flag — set another template as default first' };
          }
        }
      } else {
        // Create path: if no non-deleted template currently has IsDefault, require it here.
        const anyDefault = allValues.slice(1).some((r) => {
          const del = String(r[TemplatesCol.DeletedAt] ?? '').trim();
          const def = r[TemplatesCol.IsDefault];
          return !del && (def === true || String(def).toUpperCase() === 'TRUE');
        });
        if (!anyDefault) {
          return { ok: false, error: 'INVALID_INPUT', field: 'isDefault', reason: 'No default template exists — set this template as default' };
        }
      }
    }

    // Step 7: write the row.
    const now = nowIso();
    const createdAt = isCreate ? now : String(allValues[activeRowIdx - 1][TemplatesCol.CreatedAt] ?? now);

    const row = new Array(TEMPLATES_HEADERS.length).fill('');
    row[TemplatesCol.TemplateId]   = t.templateId;
    row[TemplatesCol.Name]         = t.name.trim();
    row[TemplatesCol.Preamble]     = t.preamble;
    row[TemplatesCol.SectionsJson] = JSON.stringify(t.sections);
    row[TemplatesCol.Credits]      = t.credits;
    row[TemplatesCol.IsDefault]    = t.isDefault;
    row[TemplatesCol.CreatedAt]    = createdAt;
    row[TemplatesCol.UpdatedAt]    = now;
    row[TemplatesCol.UpdatedBy]    = callerEmail;
    row[TemplatesCol.DeletedAt]    = '';

    if (isCreate) {
      sheet.appendRow(row);
    } else {
      sheet.getRange(activeRowIdx, 1, 1, TEMPLATES_HEADERS.length).setValues([row]);
    }

    return { ok: true, templateId: t.templateId, updatedAt: now };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// Slice 4 — deleteTemplate: admin-only soft delete.
// ---------------------------------------------------------------------------

export function deleteTemplate(templateId: string): DeleteTemplateResult {
  const callerEmail = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!callerEmail) return { ok: false, error: 'NOT_AUTHORIZED' };
  const adminsRaw = PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_EMAILS) ?? '';
  const allowed = adminsRaw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  if (!allowed.includes(callerEmail)) return { ok: false, error: 'NOT_AUTHORIZED' };

  if (!templateId || templateId.length > MAX_ID_FIELD)
    return { ok: false, error: 'INVALID_INPUT', field: 'templateId', reason: 'required' };

  const result = withLock<DeleteTemplateResult>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return { ok: false, error: 'NOT_CONFIGURED' as const };
    const sheet = getSheetOrNull(ss, SHEET_TEMPLATES);
    if (!sheet) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const allValues = sheet.getDataRange().getValues();

    // Find the active row for this templateId.
    let targetRowIdx = -1;
    for (let i = 1; i < allValues.length; i++) {
      const rowId = String(allValues[i][TemplatesCol.TemplateId] ?? '');
      const deletedAt = String(allValues[i][TemplatesCol.DeletedAt] ?? '').trim();
      if (rowId === templateId && !deletedAt) { targetRowIdx = i + 1; break; }
    }
    if (targetRowIdx < 0) return { ok: false, error: 'NOT_FOUND' as const };

    const targetRow = allValues[targetRowIdx - 1];

    // Guard: cannot delete the default template.
    const isDefault = targetRow[TemplatesCol.IsDefault];
    if (isDefault === true || String(isDefault).toUpperCase() === 'TRUE') {
      return { ok: false, error: 'INVALID_INPUT', field: 'templateId', reason: 'Cannot delete the default template — set another as default first' };
    }

    // Guard: cannot delete the sole remaining non-deleted template.
    const nonDeletedCount = allValues.slice(1).filter((r) => !String(r[TemplatesCol.DeletedAt] ?? '').trim()).length;
    if (nonDeletedCount <= 1) {
      return { ok: false, error: 'INVALID_INPUT', field: 'templateId', reason: 'Cannot delete the only remaining template' };
    }

    updateCells(sheet, targetRowIdx, { [TemplatesCol.DeletedAt + 1]: nowIso() });
    return { ok: true };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// S5-1 — getNetTypes: read the NET_TYPES Settings row; return string[].
// No lock needed — read-only. Empty array on any error so the client
// degrades gracefully to an "Other…"-only dropdown.
// ---------------------------------------------------------------------------

export function getNetTypes(): string[] {
  const ss = getSpreadsheetOrNull();
  if (!ss) return [];

  const settings = getSheetOrNull(ss, SHEET_SETTINGS);
  if (!settings) return [];

  const row = findRowData(settings, (r) => String(r[0]) === SETTING_NET_TYPES);
  if (!row) return [];

  const raw = String(row[1] ?? '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string' && t.length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// S5-1 — saveNetTypes: admin-only; writes the NET_TYPES Settings row.
// Validates: ≤ 50 entries, each ≤ MAX_NET_TYPE chars, no empty strings.
// '*' is allowed — the client uses it as a wildcard to show "Other…"
// to all NCOs (admin's way of crowdsourcing new type ideas).
// ---------------------------------------------------------------------------

export function saveNetTypes(types: string[]): SaveNetTypesResult {
  const callerEmail = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!callerEmail) return { ok: false, error: 'NOT_AUTHORIZED' };
  const adminsRaw = PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_EMAILS) ?? '';
  const allowed = adminsRaw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  if (!allowed.includes(callerEmail)) return { ok: false, error: 'NOT_AUTHORIZED' };

  if (!Array.isArray(types)) {
    return { ok: false, error: 'INVALID_INPUT', field: 'types', reason: 'must be an array' };
  }
  if (types.length > 50) {
    return { ok: false, error: 'INVALID_INPUT', field: 'types', reason: 'max 50 entries' };
  }
  for (const t of types) {
    if (typeof t !== 'string' || t.trim().length === 0) {
      return { ok: false, error: 'INVALID_INPUT', field: 'types', reason: 'empty or non-string entry' };
    }
    if (t.length > MAX_NET_TYPE) {
      return { ok: false, error: 'INVALID_INPUT', field: 'types', reason: `entry exceeds ${MAX_NET_TYPE} chars` };
    }
  }

  const result = withLock<SaveNetTypesResult>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const settings = getSheetOrNull(ss, SHEET_SETTINGS);
    if (!settings) return { ok: false, error: 'NOT_CONFIGURED' as const };

    const json = JSON.stringify(types);
    const rowIdx = findRowIndex(settings, (r) => String(r[0]) === SETTING_NET_TYPES);
    if (rowIdx > 0) {
      // Column 2 (1-indexed) = Value.
      updateCells(settings, rowIdx, { 2: json });
    } else {
      appendRowAndGetIndex(settings, [SETTING_NET_TYPES, json]);
    }
    return { ok: true };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// S5-2 — getNcoLocations: read the NCO_LOCATIONS LRU list from Settings.
// Returns string[] (most recently used first). No lock — read-only.
// ---------------------------------------------------------------------------

export function getNcoLocations(): string[] {
  const ss = getSpreadsheetOrNull();
  if (!ss) return [];

  const settings = getSheetOrNull(ss, SHEET_SETTINGS);
  if (!settings) return [];

  const row = findRowData(settings, (r) => String(r[0]) === SETTING_NCO_LOCATIONS);
  if (!row) return [];

  const raw = String(row[1] ?? '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l): l is string => typeof l === 'string' && l.length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// S5-2 — recordNcoLocation: prepend location to NCO_LOCATIONS LRU list.
// Fire-and-forget from client — silently ignores BUSY (not fatal if missed).
// Deduplicates case-sensitively; caps list at 20 entries.
// ---------------------------------------------------------------------------

export function recordNcoLocation(location: string): void {
  const trimmed = typeof location === 'string' ? location.trim() : '';
  if (!trimmed) return;

  withLock<void>(() => {
    const ss = getSpreadsheetOrNull();
    if (!ss) return;

    const settings = getSheetOrNull(ss, SHEET_SETTINGS);
    if (!settings) return;

    const rowIdx = findRowIndex(settings, (r) => String(r[0]) === SETTING_NCO_LOCATIONS);
    let locs: string[] = [];
    if (rowIdx > 0) {
      const row = readRow(settings, rowIdx);
      const raw = String(row[1] ?? '').trim();
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          locs = parsed.filter((l): l is string => typeof l === 'string' && l.length > 0);
        }
      } catch { locs = []; }
    }

    // Dedup (case-sensitive), prepend, cap at 50.
    locs = locs.filter((l) => l !== trimmed);
    locs.unshift(trimmed);
    if (locs.length > 50) locs = locs.slice(0, 50);

    const json = JSON.stringify(locs);
    if (rowIdx > 0) {
      updateCells(settings, rowIdx, { 2: json });
    } else {
      appendRowAndGetIndex(settings, [SETTING_NCO_LOCATIONS, json]);
    }
  });
  // Silently ignore BUSY — skipping a location hint is acceptable.
}
