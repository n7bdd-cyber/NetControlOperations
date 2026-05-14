/**
 * Shared types and constants for the Slice 1 server modules.
 *
 * Teaching notes:
 *  - `export` makes a name visible to other files that `import` from this one.
 *  - `interface` defines the shape of an object — a compile-time contract.
 *    Interfaces vanish at build time; they're for type-checking only.
 *  - `type` defines a type alias. The discriminated unions below (X | Y | Z)
 *    use it because they're not simple object shapes.
 *  - `as const` tells TypeScript "treat these literal values as the narrowest
 *    possible types, don't widen them to string/number." That's how the
 *    SessionsCol enum below keeps its exact index values instead of becoming
 *    just `Record<string, number>`.
 */

// ---------------------------------------------------------------------------
// Sheet schema — header row literals + 0-based column-index enums.
// 0-based for use against `getValues()[row]` arrays. Sheet API itself is
// 1-based, so add 1 when calling `getRange(rowIdx + 1, col + 1)`.
// ---------------------------------------------------------------------------

export const SESSIONS_HEADERS = [
  'SessionID',
  'StartTimestamp',
  'NetDate',
  'NetTime',
  'NetType',
  'NCOCallsign',
  'NCOEmail',
  'Repeater',
  'PurposeNotes',
  'EndTimestamp',
  'Status',
  'RequestId',
] as const;

export const CHECKINS_HEADERS = [
  'CheckinID',
  'SessionID',
  'Callsign',
  'FirstTimestamp',
  'LatestTimestamp',
  'TapCount',
  'LoggedByNCOEmail',
  'Source',
  'LastTappedByNCOEmail',
  'LastTappedEventId',
] as const;

export const ROSTER_HEADERS = ['Callsign', 'Name', 'LastActive'] as const;

export const SessionsCol = {
  SessionID: 0,
  StartTimestamp: 1,
  NetDate: 2,
  NetTime: 3,
  NetType: 4,
  NCOCallsign: 5,
  NCOEmail: 6,
  Repeater: 7,
  PurposeNotes: 8,
  EndTimestamp: 9,
  Status: 10,
  RequestId: 11,
} as const;

export const CheckinsCol = {
  CheckinID: 0,
  SessionID: 1,
  Callsign: 2,
  FirstTimestamp: 3,
  LatestTimestamp: 4,
  TapCount: 5,
  LoggedByNCOEmail: 6,
  Source: 7,
  LastTappedByNCOEmail: 8,
  LastTappedEventId: 9,
} as const;

export const RosterCol = {
  Callsign: 0,
  Name: 1,
  LastActive: 2,
} as const;

export const SHEET_SESSIONS = 'Sessions';
export const SHEET_CHECKINS = 'Checkins';
export const SHEET_ROSTER = 'Roster';

export const SESSION_STATUS_OPEN = 'Open';
export const SESSION_STATUS_CLOSED = 'Closed';

export const SOURCE_MANUAL = 'Manual';

// ---------------------------------------------------------------------------
// Script Properties keys.
// ---------------------------------------------------------------------------

export const PROP_SPREADSHEET_ID = 'SpreadsheetId';
export const PROP_ADMIN_EMAILS = 'AdminEmails';

// ---------------------------------------------------------------------------
// Field length caps (validators clamp longer strings server-side).
// ---------------------------------------------------------------------------

export const MAX_NET_TYPE = 100;
export const MAX_REPEATER = 100;
export const MAX_PURPOSE_NOTES = 500;
// MAX_CALLSIGN: chosen to fit the longest string the callsign regex in
// src/server/validators.ts can match — DX prefix `AAA0AA/` (7) + base `KE7XYZ`
// (6) + secondary `/QRPMM` (6) = 19. Rounded down to 18 because real-world
// callsigns top out around 14 chars (e.g. KH6/KE7XYZ/QRP) and an 18-char
// cap leaves a small safety margin without permitting nonsense like
// `AAA0AA/KE7XYZ/QRPMM`. Keep this in sync with the `maxlength` attributes
// on f-nco and f-callsign in src/html/index.html and with the client-side
// length guard in `validCallsign` there.
export const MAX_CALLSIGN = 18;
export const MAX_ID_FIELD = 64; // requestId, eventId, sessionId

// ---------------------------------------------------------------------------
// Server function input / output types.
// ---------------------------------------------------------------------------

export interface StartSessionInput {
  requestId: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm" 24h
  netType: string;
  ncoCallsign: string;
  repeater?: string;
  purposeNotes?: string;
}

export type StartSessionResult =
  | { ok: true; sessionId: string; deduped: boolean }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

export interface RecordCheckinInput {
  sessionId: string;
  callsign: string;
  eventId: string;
}

export type RecordCheckinResult =
  | {
      ok: true;
      checkinId: string;
      firstEventForCallsignInSession: boolean;
      tapCount: number;
      deduped: boolean;
    }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'INVALID_CALLSIGN' }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_CLOSED' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

export interface EndSessionInput {
  sessionId: string;
}

export type EndSessionResult =
  | {
      ok: true;
      checkinCount: number;
      uniqueCallsignCount: number;
      hoursTotal: number;
      spreadsheetUrl: string;
      alreadyClosed: boolean;
    }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

// Literal union, not `string[]`, so a typo in a `created.push('Rooster')` call
// fails at compile time. Tab semantics:
//   'Sessions' / 'Checkins' — Slice 1 spine.
//   'Roster'   — Slice 2 tab populated by Sunday-Sync (Slice 3) from the
//                ActivARES member CSV. Lookup target for Suffix-Tap.
//   'Others'   — future tab for non-member callsigns the NCO logs during a
//                net (visitors, drop-ins, unresolved callsigns). Not created
//                by Slice 2's setupSheets yet; the literal is in the union
//                ahead of the slice that wires it up, so the type stays
//                stable when that slice lands.
export type SetupSheetsResult =
  | { ok: true; created: ('Sessions' | 'Checkins' | 'Roster' | 'Others')[] }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'NOT_AUTHORIZED' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' };

// Slice 2 — Suffix-Tap (FR-2 + FR-3, text-input subset).

export interface RosterEntry {
  callsign: string;
  // `name` may be the empty string when the Roster row's Name column is blank.
  name: string;
  // `lastActive` is whatever string is in the Roster row's LastActive column,
  // coerced from cell value. Slice 2 does not validate the shape; Sunday-Sync
  // (Slice 3) will write well-formed ISO dates here.
  lastActive: string;
}

export type GetRosterSnapshotResult =
  | { ok: true; roster: RosterEntry[] }
  // Spreadsheet not configured OR Roster tab missing.
  | { ok: false; error: 'NOT_CONFIGURED' }
  // getDataRange().getValues() threw — typically a transient Apps Script /
  // Sheets API error or a quota exhaustion. The client treats this the same
  // as NOT_CONFIGURED ("no usable roster"); the two are kept distinct on the
  // server so cloud logs attribute cause.
  | { ok: false; error: 'READ_FAILED' };
