/**
 * Entry-point functions exposed to Apps Script.
 *
 * After `npm run build`, esbuild bundles this file (and all its dependencies)
 * into dist/Code.gs. The footer in scripts/build.mjs hoists every exported
 * function in this file onto the global object so Apps Script can find them.
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
  MAX_ID_FIELD,
  MAX_NAME,
  MAX_NET_TYPE,
  MAX_PURPOSE_NOTES,
  MAX_REPEATER,
  OTHERS_HEADERS,
  OthersCol,
  PROP_ADMIN_EMAILS,
  PROP_CALLOOK_BASE_URL,
  PROP_ROSTER_CSV_DRIVE_FOLDER_ID,
  PROP_SPREADSHEET_ID,
  PROP_TRUSTEE_EMAIL,
  ROSTER_HEADERS,
  RosterCol,
  SESSIONS_HEADERS,
  SETTINGS_HEADERS,
  SessionsCol,
  SESSION_STATUS_CLOSED,
  SESSION_STATUS_OPEN,
  SHEET_CHECKINS,
  SHEET_OTHERS,
  SHEET_ROSTER,
  SHEET_SESSIONS,
  SHEET_SETTINGS,
  SOURCE_MANUAL,
  type EndSessionInput,
  type EndSessionResult,
  type GetRosterSnapshotResult,
  type ReconcileResult,
  type RecordCheckinInput,
  type RecordCheckinResult,
  type ResolveNameResult,
  type RosterEntry,
  type SetupSheetsResult,
  type StartSessionInput,
  type StartSessionResult,
} from './types';
import {
  appendRowAndGetIndex,
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
          resolvedName: null,
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
      const rosterRowIdx = findRowIndex(
        rosterSheet,
        (row) => String(row[RosterCol.Callsign]) === input.callsign,
      );
      if (rosterRowIdx > 0) {
        // Roster member: resolve name directly from Roster.
        const rosterRow = readRow(rosterSheet, rosterRowIdx);
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

    const created: ('Sessions' | 'Checkins' | 'Roster' | 'Others' | 'Settings')[] = [];

    const sessions = getOrCreateSheetWithHeader(ss, SHEET_SESSIONS, SESSIONS_HEADERS);
    if (sessions.created) created.push('Sessions');

    const checkins = getOrCreateSheetWithHeader(ss, SHEET_CHECKINS, CHECKINS_HEADERS);
    if (checkins.created) created.push('Checkins');

    const roster = getOrCreateSheetWithHeader(ss, SHEET_ROSTER, ROSTER_HEADERS);
    if (roster.created) created.push('Roster');

    const others = getOrCreateSheetWithHeader(ss, SHEET_OTHERS, OTHERS_HEADERS);
    if (others.created) created.push('Others');

    const settings = getOrCreateSheetWithHeader(ss, SHEET_SETTINGS, SETTINGS_HEADERS);
    if (settings.created) created.push('Settings');

    Logger.log(`setupSheets: created=${JSON.stringify(created)}`);
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
