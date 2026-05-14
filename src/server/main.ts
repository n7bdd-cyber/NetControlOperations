/**
 * Entry-point functions exposed to Apps Script.
 *
 * After `npm run build`, esbuild bundles this file (and all its dependencies)
 * into dist/Code.gs. The footer in scripts/build.mjs hoists every exported
 * function in this file onto the global object so Apps Script can find them
 * (doGet, startSession, recordCheckin, endSession, setupSheets).
 *
 * Teaching notes:
 *  - Discriminated unions: `Result = Success | Failure1 | Failure2 | ...`. We
 *    check `result.ok` and TypeScript narrows the type for us on each branch.
 *  - `as const` literals: `'INVALID_INPUT' as const` keeps TypeScript from
 *    widening the string to plain `string`, which would break the union match.
 *  - All write paths run inside `withLock(() => { ... })`. If the lock can't
 *    be acquired in 10 seconds, we return BUSY_TRY_AGAIN and the client retries.
 */

import {
  CHECKINS_HEADERS,
  CheckinsCol,
  MAX_ID_FIELD,
  MAX_NET_TYPE,
  MAX_PURPOSE_NOTES,
  MAX_REPEATER,
  PROP_ADMIN_EMAILS,
  PROP_SPREADSHEET_ID,
  ROSTER_HEADERS,
  RosterCol,
  SESSIONS_HEADERS,
  SessionsCol,
  SESSION_STATUS_CLOSED,
  SESSION_STATUS_OPEN,
  SHEET_CHECKINS,
  SHEET_ROSTER,
  SHEET_SESSIONS,
  SOURCE_MANUAL,
  type EndSessionInput,
  type EndSessionResult,
  type GetRosterSnapshotResult,
  type RecordCheckinInput,
  type RecordCheckinResult,
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
  // netType: server checks non-empty only. Length is clamped on write
  // (per design §"Server-side input policy" — server clamps, client rejects).
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
      // Dedup check: same eventId → harmless retry. No email lookup needed.
      if (String(existingRow[CheckinsCol.LastTappedEventId]) === input.eventId) {
        return {
          ok: true,
          checkinId: String(existingRow[CheckinsCol.CheckinID]),
          firstEventForCallsignInSession: false,
          tapCount: Number(existingRow[CheckinsCol.TapCount]) || 0,
          deduped: true,
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
      };
    }

    // First-ever event for this callsign in this session.
    const email = Session.getActiveUser().getEmail();
    const checkinId = newUuid();
    const now = nowIso();
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

    appendRowAndGetIndex(checkins, row);
    return {
      ok: true,
      checkinId,
      firstEventForCallsignInSession: true,
      tapCount: 1,
      deduped: false,
    };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// endSession — FR-9 (Sheet write half; MailApp deferred to a later slice).
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
    // Why a Set rather than a row counter: recordCheckin enforces one row per
    // (sessionId, callsign), but a future writer (Sunday-Sync import, backfill,
    // manual edit) could violate that. Counting unique callsigns directly keeps
    // the EC volunteer-hours number (uniqueCallsignCount * 0.5) honest even if
    // the invariant slips.
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

    // Close it.
    updateCells(sessions, sessionRowIdx, {
      [SessionsCol.EndTimestamp + 1]: nowIso(),
      [SessionsCol.Status + 1]: SESSION_STATUS_CLOSED,
    });

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
// setupSheets — admin bootstrap. Creates Sessions, Checkins, and Roster tabs.
// Gated by the AdminEmails Script Property.
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

    const created: ('Sessions' | 'Checkins' | 'Roster' | 'Others')[] = [];
    const sessions = getOrCreateSheetWithHeader(ss, SHEET_SESSIONS, SESSIONS_HEADERS);
    if (sessions.created) created.push('Sessions');
    const checkins = getOrCreateSheetWithHeader(ss, SHEET_CHECKINS, CHECKINS_HEADERS);
    if (checkins.created) created.push('Checkins');
    const roster = getOrCreateSheetWithHeader(ss, SHEET_ROSTER, ROSTER_HEADERS);
    if (roster.created) created.push('Roster');

    // Log the action, but NOT the admin email — execution history already records the caller.
    Logger.log(`setupSheets: created=${JSON.stringify(created)}`);
    return { ok: true, created };
  });

  return result === 'BUSY' ? { ok: false, error: 'BUSY_TRY_AGAIN' } : result;
}

// ---------------------------------------------------------------------------
// getRosterSnapshot — FR-2 (narrower signature than the PRD spec: no
// asOfTimestamp, no RosterVersion; widening planned when IndexedDB lands).
//
// Read-only; no LockService (project convention: locks for writes only).
// No in-app admin gate — any signed-in Google account that can reach the
// web app can call this. Callsigns + names are FCC-public per PRD §161.
// ---------------------------------------------------------------------------

export function getRosterSnapshot(): GetRosterSnapshotResult {
  const ss = getSpreadsheetOrNull();
  if (!ss) return { ok: false, error: 'NOT_CONFIGURED' };

  // `getSheetByName` is usually total but can throw under transient
  // Sheets-API failures; we want that to surface as READ_FAILED for log
  // attribution rather than as an uncaught exception.
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

  // Iterate data rows (skip header at index 0). Dedup by callsign: last-write-
  // wins on row order, so a Sunday-Sync (Slice 3) re-write can rely on this.
  const seen = new Map<string, RosterEntry>();
  for (let i = 1; i < values.length; i++) {
    // Per-row try/catch so one bad row doesn't sink the whole snapshot.
    try {
      const row = values[i];
      const callsign = String(row[RosterCol.Callsign] ?? '').trim();
      if (!callsign) continue; // silent skip for trailing blank rows
      if (!isValidCallsign(callsign)) {
        Logger.log(`getRosterSnapshot: skipping malformed row ${i}: ${callsign}`);
        continue;
      }
      const name = String(row[RosterCol.Name] ?? '').trim();
      const lastActive = String(row[RosterCol.LastActive] ?? '').trim();
      seen.set(callsign, { callsign, name, lastActive });
    } catch (e) {
      Logger.log(`getRosterSnapshot: row ${i} threw: ${String(e)}`);
    }
  }

  return { ok: true, roster: Array.from(seen.values()) };
}
