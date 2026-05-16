/**
 * Project: NetControlOperations
 * File: types.ts
 * System Version: 1.0.0 | File Version: 8 | Date: 2026-05-15
 *   v8: S5-12 — WinlinkMessage interface and WinlinkMessageResult type added.
 *   v7: S5-11 — NtsMessage interface and NtsMessageResult type added.
 *   v6: S5-10 — ICS 309/214 export interfaces and IcsExportResult type added.
 *   v5: S5-3 — OtherEntry interface and GetOthersSnapshotResult type added.
 *   v4: S5-2 — SETTING_NCO_LOCATIONS constant added.
 *   v3: S5-1 — SETTING_NET_TYPES constant; SaveNetTypesResult type added.
 *   v2: S5-7 — ReopenSessionInput and ReopenSessionResult added.
 *   v1: Initial version tracking. All sheet schemas, column-index constants,
 *       and result interfaces for Slices 1–4 (including Repeaters / Templates).
 *
 * Description: Shared types and constants imported by all server modules.
 *   Sheet header arrays: SESSIONS_HEADERS, CHECKINS_HEADERS, ROSTER_HEADERS,
 *     OTHERS_HEADERS, SETTINGS_HEADERS, TEMPLATES_HEADERS, REPEATERS_HEADERS
 *   Column-index objects: SessionsCol, CheckinsCol, RosterCol, OthersCol,
 *     TemplatesCol, RepeatersCol
 *   Tab name constants: SHEET_SESSIONS … SHEET_REPEATERS
 *   Script property keys: PROP_SPREADSHEET_ID, PROP_ADMIN_EMAILS, etc.
 *   Settings value keys: SETTING_NET_TYPES
 *   MAX_* length caps; SESSION_STATUS_* constants; SOURCE_MANUAL
 *   Interfaces: OthersEntry, TemplateSection, NetTemplate, RepeaterEntry,
 *     RepeaterSystem, RosterEntry, StartSessionInput, RecordCheckinInput,
 *     EndSessionInput, ReopenSessionInput, SaveTemplateInput,
 *     ResolveNameResult, ReconcileResult
 *   Result union types for every exported server function
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
  'NCOName',        // Slice 4 — appended; existing rows get blank on read
  'NCOLocation',    // Slice 4
  'RepeaterSystem', // Slice 4
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

export const TEMPLATES_HEADERS = [
  'TemplateId', 'Name', 'Preamble', 'SectionsJson', 'Credits',
  'IsDefault', 'CreatedAt', 'UpdatedAt', 'UpdatedBy', 'DeletedAt',
] as const;

export const REPEATERS_HEADERS = [
  'SystemName', 'RepeaterName', 'Frequency', 'PlTone', 'Type',
  'DisplayOrder', 'IsActive', 'Description', 'ClosingCredit',
] as const;

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
  NCOName: 12,        // Slice 4
  NCOLocation: 13,    // Slice 4
  RepeaterSystem: 14, // Slice 4
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

export const TemplatesCol = {
  TemplateId:   0,
  Name:         1,
  Preamble:     2,
  SectionsJson: 3,
  Credits:      4,
  IsDefault:    5,
  CreatedAt:    6,
  UpdatedAt:    7,
  UpdatedBy:    8,
  DeletedAt:    9,
} as const;

export const RepeatersCol = {
  SystemName:    0,
  RepeaterName:  1,
  Frequency:     2,
  PlTone:        3,
  Type:          4,
  DisplayOrder:  5,
  IsActive:      6,
  Description:   7,
  ClosingCredit: 8,
} as const;

export const SHEET_SESSIONS = 'Sessions';
export const SHEET_CHECKINS = 'Checkins';
export const SHEET_ROSTER = 'Roster';
export const SHEET_OTHERS = 'Others';
export const SHEET_SETTINGS = 'Settings';
export const SHEET_TEMPLATES = 'Templates';
export const SHEET_REPEATERS = 'Repeaters';

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
// Settings tab value keys (Key column in the Settings sheet).
// ---------------------------------------------------------------------------

export const SETTING_NET_TYPES = 'NET_TYPES';
export const SETTING_NCO_LOCATIONS = 'NCO_LOCATIONS';

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

// Slice 4 field length caps.
export const MAX_NCO_NAME              = 100;
export const MAX_NCO_LOCATION          = 100;
export const MAX_SYSTEM_NAME           = 100;
export const MAX_TEMPLATE_NAME         = 100;
export const MAX_PREAMBLE              = 5000;
export const MAX_CREDITS               = 2000;
export const MAX_SECTION_TITLE         = 100;
export const MAX_SECTION_CALL_TO_AIR   = 500;
export const MAX_SECTION_NOTES         = 500;
export const MAX_SECTIONS_PER_TEMPLATE = 20;

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
// Slice 4 — Templates and Repeaters types.
// ---------------------------------------------------------------------------

export interface TemplateSection {
  id:        string;   // UUID client-generated; unique within the template
  title:     string;
  callToAir: string;   // text read on air; {{variables}} substituted client-side
  notes:     string;   // NCO-only instruction; NOT substituted; NOT read on air
  order:     number;   // 1-based; unique within the template
}

export interface NetTemplate {
  templateId:          string;
  name:                string;
  preamble:            string;
  sections:            TemplateSection[];
  credits:             string;
  isDefault:           boolean;
  createdAt:           string;
  updatedAt:           string;
  updatedBy:           string;   // Google email of last editor
  deletedAt:           string;   // blank = active; non-blank = soft-deleted
  sectionsParseError?: boolean;  // true when SectionsJson cell contained malformed JSON
}

export interface RepeaterEntry {
  systemName:    string;
  repeaterName:  string;
  frequency:     string;
  plTone:        string;
  type:          string;   // raw value as stored; normalize only for classification
  displayOrder:  number;
  isActive:      boolean;
  description:   string;
  closingCredit: string;
}

export interface RepeaterSystem {
  name:      string;
  primary:   RepeaterEntry[];   // type (lowercase) === 'primary', sorted by displayOrder
  linked:    RepeaterEntry[];   // type (lowercase) === 'linked', sorted by displayOrder
  alternate: RepeaterEntry[];   // type (lowercase) === 'alternate', sorted by displayOrder
  links:     RepeaterEntry[];   // all other types, sorted by displayOrder
}

export interface SaveTemplateInput {
  template: NetTemplate;
}

export type SaveTemplateResult =
  | { ok: true; templateId: string; updatedAt: string }
  | { ok: false; error: 'NOT_AUTHORIZED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

export type GetTemplatesResult =
  | { ok: true; templates: NetTemplate[] }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'READ_FAILED' };

export type DeleteTemplateResult =
  | { ok: true }
  | { ok: false; error: 'NOT_AUTHORIZED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'NOT_FOUND' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

export type GetRepeaterSystemsResult =
  | { ok: true; systems: RepeaterSystem[] }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'READ_FAILED' };

// ---------------------------------------------------------------------------
// Server function input / output types.
// ---------------------------------------------------------------------------

export interface StartSessionInput {
  requestId:        string;
  date:             string;   // "YYYY-MM-DD"
  time:             string;   // "HH:mm" 24h
  netType:          string;
  ncoCallsign:      string;
  repeater?:        string;
  purposeNotes?:    string;
  ncoName?:         string;   // Slice 4
  ncoLocation?:     string;   // Slice 4
  repeaterSystem?:  string;   // Slice 4 — SystemName of selected system
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

export interface ReopenSessionInput {
  sessionId: string;
}

export type ReopenSessionResult =
  | { ok: true }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'ALREADY_OPEN' }
  | { ok: false; error: 'WINDOW_EXPIRED' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

// S5-1 — Net types managed list.
export type SaveNetTypesResult =
  | { ok: true }
  | { ok: false; error: 'NOT_AUTHORIZED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

// Tab literals ordered by creation. Tab semantics:
//   'Sessions' / 'Checkins' — Slice 1 spine.
//   'Roster'   — populated by Sunday-Sync from the ActivARES member CSV.
//   'Others'   — non-member callsign cache (visitors, drop-ins, unresolved).
//   'Settings' — key/value config placeholder; UI deferred to a later slice.
//   'Templates' / 'Repeaters' — Slice 4 net script feature.
export type SetupSheetsResult =
  | { ok: true; created: ('Sessions' | 'Checkins' | 'Roster' | 'Others' | 'Settings' | 'Templates' | 'Repeaters')[] }
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

// S5-3 — visitor/others snapshot for client-side band3 suffix-tap.

export interface OtherEntry {
  callsign: string;
  name: string; // blank when FCC lookup hasn't run yet
}

export type GetOthersSnapshotResult =
  | { ok: true;  others: OtherEntry[] }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'READ_FAILED' };

// S5-10 — ICS 309 / ICS 214 export.

export interface Ics309Row {
  dateTime:  string;   // "HH:mm" local
  from:      string;   // checking-in callsign
  to:        string;   // NCO callsign
  frequency: string;   // e.g. "145.450 MHz" or blank
  mode:      string;   // "FM" for v1
  message:   string;   // "Check-in" or "Check-in (×N)"
  remarks:   string;   // name if known, else blank
}

export interface Ics309Payload {
  incidentName:       string;
  opPeriodFrom:       string;  // "MM/DD/YYYY HH:mm"
  opPeriodTo:         string;
  radioNetName:       string;
  operatorName:       string;
  operatorPosition:   string;
  operatorCallsign:   string;
  stationLog:         Ics309Row[];
  preparedByName:     string;
  preparedByCallsign: string;
  preparedByDateTime: string;
}

export interface Ics214PersonRow {
  callsign:    string;
  name:        string;
  icsPosition: string;
  homeAgency:  string;
}

export interface Ics214ActivityRow {
  dateTime: string;   // "MM/DD/YYYY HH:mm"
  activity: string;
}

export interface Ics214Payload {
  incidentName:       string;
  opPeriodFrom:       string;
  opPeriodTo:         string;
  unitLeaderName:     string;
  unitLeaderPosition: string;
  homeAgency:         string;
  personnel:          Ics214PersonRow[];
  activityLog:        Ics214ActivityRow[];
  preparedByName:     string;
  preparedByCallsign: string;
  preparedByDateTime: string;
}

export interface IcsExportPayload {
  ics309Text: string;       // pre-formatted plain text for <pre>
  ics214Text: string;
  ics309:     Ics309Payload;
  ics214:     Ics214Payload;
}

export type IcsExportResult =
  | { ok: true;  payload: IcsExportPayload }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_NOT_CLOSED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'READ_FAILED' };

// Slice 3 — async FCC name resolution.

export interface ResolveNameResult {
  callsign: string;
  checkinId: string;
  name: string | null;
  fccName: string | null;
}

// S5-11 — NTS Practice Message.

export interface NtsMessage {
  precedence:           string;   // "ROUTINE"
  handlingInstructions: string;   // blank for v1
  messageNumber:        string;   // e.g. "abc123-001"
  stationOfOrigin:      string;
  arlCheck:             number;   // word count of messageText (excluding "END")
  placeOfOrigin:        string;
  dateFiled:            string;   // "MAY 15"
  timeFiled:            string;   // "1900"
  addresseeName:        string;
  addresseeAddress:     string;
  addresseeCity:        string;
  addresseePhone:       string;   // blank
  messageText:          string;
  signature:            string;
  formattedText:        string;   // ready for display in <pre>
}

export type NtsMessageResult =
  | { ok: true;  message: NtsMessage }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_CLOSED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'NOT_CONFIGURED' };

// S5-12 — WinLink Practice Message.

export interface WinlinkMessage {
  to:            string;   // "W6BA@winlink.org"
  cc:            string;   // blank
  from:          string;   // "{ncoCallsign}@winlink.org"
  subject:       string;
  date:          string;   // display-only date string
  body:          string;   // plain text body
  formattedText: string;   // ready for display in <pre>
}

export type WinlinkMessageResult =
  | { ok: true;  message: WinlinkMessage }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_CLOSED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'NOT_CONFIGURED' };

export interface ReconcileResult {
  checked: number;
  silentlyResolved: number;
  conflicts: number;
  skipped: number;   // rows already NameConflict=TRUE — not re-processed
  timedOut: boolean;
  remaining: number;
}
