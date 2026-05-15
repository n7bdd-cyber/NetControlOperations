/**
 * Shared types and constants for the server modules.
 *
 * Teaching notes:
 *  - `export` makes a name visible to other files that `import` from this one.
 *  - `interface` defines the shape of an object — a compile-time contract.
 *    Interfaces vanish at build time; they're for type-checking only.
 *  - `type` defines a type alias. The discriminated unions below (X | Y | Z)
 *    use it because they're not simple object shapes.
 *  - `as const` tells TypeScript "treat these literal values as the narrowest
 *    possible types, don't widen them to string/number." That's how the
 *    SessionsCol object below keeps its exact index values instead of becoming
 *    just `Record<string, number>`.
 */

// ---------------------------------------------------------------------------
// Sheet schema — header row literals + 0-based column-index objects.
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

// Name appended at index 10 — safe because existing Slices 1-2 rows have
// 10 columns (indices 0-9); the new column lands beyond them without shifting.
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
  'Name',
] as const;

// LastActive removed (was a Slice 2 stub — ActivARES CSV has no per-entry
// timestamps); LicenseClass replaces it, sourced from the Sunday-Sync CSV.
export const ROSTER_HEADERS = ['Callsign', 'Name', 'LicenseClass'] as const;

export const OTHERS_HEADERS = [
  'Callsign',
  'Name',
  'FccName',
  'Source',
  'NameConflict',
  'LastActive',
] as const;

export const SETTINGS_HEADERS = ['Key', 'Value'] as const;

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
  Name: 10,
} as const;

export const RosterCol = {
  Callsign: 0,
  Name: 1,
  LicenseClass: 2,
} as const;

export const OthersCol = {
  Callsign: 0,
  Name: 1,
  FccName: 2,
  Source: 3,
  NameConflict: 4,
  LastActive: 5,
} as const;

export const SHEET_SESSIONS = 'Sessions';
export const SHEET_CHECKINS = 'Checkins';
export const SHEET_ROSTER = 'Roster';
export const SHEET_OTHERS = 'Others';
export const SHEET_SETTINGS = 'Settings';

export const SESSION_STATUS_OPEN = 'Open';
export const SESSION_STATUS_CLOSED = 'Closed';

export const SOURCE_MANUAL = 'Manual';

// ---------------------------------------------------------------------------
// Script Properties keys.
// ---------------------------------------------------------------------------

export const PROP_SPREADSHEET_ID = 'SpreadsheetId';
export const PROP_ADMIN_EMAILS = 'AdminEmails';
export const PROP_CALLOOK_BASE_URL = 'CallookBaseUrl';
export const PROP_TRUSTEE_EMAIL = 'TrusteeEmail';
export const PROP_ROSTER_CSV_DRIVE_FOLDER_ID = 'RosterCsvDriveFolderId';

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
export const MAX_ID_FIELD = 64; // requestId, eventId, sessionId, checkinId
export const MAX_NAME = 64;     // setManualName — name the NCO heard on air

// ---------------------------------------------------------------------------
// Others tab types.
// ---------------------------------------------------------------------------

export type OthersSource = 'fcc' | 'manual' | 'pending';

export interface OthersEntry {
  callsign: string;
  name: string;
  fccName: string;
  source: OthersSource;
  nameConflict: boolean;
  lastActive: string;
}

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
      // resolveAsync: true  → client must call resolveName (FCC lookup pending).
      // resolveAsync: false → name already resolved; resolvedName has the value
      //   (may be null for roster members whose Name column is blank).
      resolveAsync: boolean;
      resolvedName: string | null;
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

// Tab literals ordered by creation. Tab semantics:
//   'Sessions' / 'Checkins' — Slice 1 spine.
//   'Roster'   — populated by Sunday-Sync from the ActivARES member CSV.
//   'Others'   — non-member callsign cache (visitors, drop-ins, unresolved).
//   'Settings' — key/value config placeholder; UI deferred to a later slice.
export type SetupSheetsResult =
  | { ok: true; created: ('Sessions' | 'Checkins' | 'Roster' | 'Others' | 'Settings')[] }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'NOT_AUTHORIZED' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' };

// Slice 2 — Suffix-Tap (FR-2 + FR-3, text-input subset).

export interface RosterEntry {
  callsign: string;
  // `name` may be the empty string when the Roster row's Name column is blank.
  name: string;
  // `licenseClass` is whatever string is in the Roster row's LicenseClass column,
  // sourced from the ActivARES CSV on Sunday-Sync. e.g. 'General', 'Extra'.
  licenseClass: string;
}

export type GetRosterSnapshotResult =
  | { ok: true; roster: RosterEntry[] }
  // Spreadsheet not configured OR Roster tab missing.
  | { ok: false; error: 'NOT_CONFIGURED' }
  // getDataRange().getValues() threw — typically a transient Apps Script /
  // Sheets API error or a quota exhaustion.
  | { ok: false; error: 'READ_FAILED' };

// Slice 3 — async FCC name resolution.

export interface ResolveNameResult {
  callsign: string;
  checkinId: string;
  name: string | null;
  fccName: string | null;
}

export interface ReconcileResult {
  checked: number;
  silentlyResolved: number;
  conflicts: number;
  skipped: number;   // rows already NameConflict=TRUE — not re-processed
  timedOut: boolean;
  remaining: number;
}
