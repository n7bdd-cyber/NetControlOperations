# Design Doc: Slice 3 — Sunday-Sync, Others Cache, and Name Reconciliation

**Date:** 2026-05-14
**Revision:** 2026-05-14 — round 2 (addresses all round-2 bee findings + 4 user decisions)
**Source:** Design conversation with Brian Darby on 2026-05-14
**Implements PRD FRs:** FR-11 (Sunday-Sync trigger), FR-5 (Unknown callsign queue — via Others tab), FR-6 (Async FCC resolver — on-demand at check-in, not hourly trigger)

**PRD divergences in this slice:**
- PRD FR-6 specifies an *hourly* `asyncResolveUnknowns` trigger. This slice replaces that with on-demand async lookup via `google.script.run` at check-in time, plus a weekly batch reconciliation (`reconcileOthersNames`) as the last step of `sundaySync`. The hourly trigger is dropped entirely.
- PRD models `RosterFallback` + `UnknownCallsigns` as two separate tabs. This slice collapses them into a single `Others` tab with `Source` and `NameConflict` columns.
- PRD defers the `Settings` tab to FR-14. This slice introduces it as a placeholder (created by `setupSheets`, no rows seeded yet). The `CallookBaseUrl` lives in `PropertiesService`, not the Sheet — see §Security.

**Defers:** Settings panel UI (FR-14), IndexedDB caching (PWA slice), FR-7/FR-8/FR-9/FR-10/FR-12/FR-13/FR-15/FR-16, thumb-zone keypad.

---

## Why

Slice 2 smoke-tested green on 2026-05-14. The `Roster` tab is hand-populated. Slice 3 makes the roster live via `sundaySync` and adds the `Others` cache so non-member callsigns (visitors, recently-licensed hams, drop-ins) are resolved automatically without the NCO typing a name.

---

## Scope

**In:**
- New `Others` Sheet tab (schema below); created by updated `setupSheets`.
- New `Settings` Sheet tab placeholder; created by `setupSheets` with headers only — no rows seeded this slice.
- `sundaySync()` time-driven trigger + `installSundaySyncTrigger()`.
- `reconcileOthersNames()` standalone function; also run-dropdown callable.
- `resolveName(callsign, checkinId)` server function — async via `google.script.run`.
- `setManualName(callsign, checkinId, name)` server function.
- "Searching…" / "Check back" pill UX in the client log.
- Manual name entry on "Check back" tap.
- Conflict digest email to trustee (re-sent each Sunday until resolved; includes timeout notice and run-dropdown instructions when applicable).
- `endSession` purge of `Others` rows where `LastActive` > 13 months.
- `recordCheckin` updated to route non-roster callsigns through `Others` and return a `resolveAsync` flag.
- `getRosterSnapshot` and `RosterEntry` updated to include `licenseClass`.

**Out (deferred):**
- Settings panel UI.
- IndexedDB caching of `Others` snapshot (PWA slice).
- Thumb-zone keypad.
- FR-7/FR-8/FR-9/FR-10/FR-12/FR-13/FR-14/FR-15/FR-16.

---

## Sheet schema changes

### `Others` tab (new)

Created by `setupSheets`. Header frozen.

| # | Column | Type | Notes |
|---|---|---|---|
| 0 | `Callsign` | string | Key; uppercased; validated against `CALLSIGN_RE` before write |
| 1 | `Name` | string | Preferred display name; blank while pending |
| 2 | `FccName` | string | Raw name string from callook.info; blank until first successful lookup |
| 3 | `Source` | string | `'fcc'` \| `'manual'` \| `'pending'` |
| 4 | `NameConflict` | boolean | `TRUE` when `Name` ≠ `FccName` and trustee has not resolved |
| 5 | `LastActive` | ISO-8601 UTC | Updated on every check-in (cache hit or new); used for purge |

```typescript
// types.ts additions
export const OTHERS_HEADERS = ['Callsign','Name','FccName','Source','NameConflict','LastActive'] as const;
export const SHEET_OTHERS   = 'Others';

export enum OthersCol {
  Callsign     = 0,
  Name         = 1,
  FccName      = 2,
  Source       = 3,
  NameConflict = 4,
  LastActive   = 5,
}

export type OthersSource = 'fcc' | 'manual' | 'pending';

export interface OthersEntry {
  callsign:     string;
  name:         string;
  fccName:      string;
  source:       OthersSource;
  nameConflict: boolean;
  lastActive:   string;
}
```

### `Settings` tab (new placeholder)

Two-column key-value table. Created by `setupSheets` with headers only. Edited directly in the Sheet at v0; a settings panel UI is deferred.

```typescript
export const SETTINGS_HEADERS = ['Key','Value'] as const;
export const SHEET_SETTINGS   = 'Settings';
```

No rows are seeded by `setupSheets` in this slice. The `CallookBaseUrl` is stored in `PropertiesService` (see §Security).

### `Roster` tab (updated schema)

`LicenseClass` replaces the prior `LastActive` column at index 2. **`LastActive` is removed from `ROSTER_HEADERS` and `RosterCol`** — it was a Slice 2 stub; the Roster is now populated exclusively from the ActivARES CSV which has no per-entry timestamps.

```typescript
export const ROSTER_HEADERS = ['Callsign','Name','LicenseClass'] as const;

export enum RosterCol {
  Callsign     = 0,
  Name         = 1,
  LicenseClass = 2,
}

export interface RosterEntry {
  callsign:     string;
  name:         string;
  licenseClass: string;  // added; replaces lastActive
}
```

`getRosterSnapshot` must be updated to read `row[RosterCol.LicenseClass]` into `licenseClass` (removing the `lastActive` read). The Suffix-Tap candidate-list display may show `licenseClass` alongside the callsign and name.

### `Checkins` tab (updated schema)

`Name` column appended at **index 10** (zero-based). This is a safe append — existing rows written by Slices 1–2 have 10 columns (indices 0–9); the new column lands beyond them.

```typescript
// Add to CHECKINS_HEADERS tuple (append at end):
// [...existing 10 headers..., 'Name']
// Add to CheckinsCol enum:
export enum CheckinsCol {
  // ...existing values...
  Name = 10,
}
```

All `recordCheckin`, `resolveName`, and `setManualName` writes to this column use `CheckinsCol.Name + 1` as the 1-based column index in `updateCells` calls (consistent with the existing pattern, e.g., `CheckinsCol.LatestTimestamp + 1`).

---

## PropertiesService constants (additions)

```typescript
export const PROP_CALLOOK_BASE_URL = 'CallookBaseUrl';   // default: 'https://callook.info/'
export const PROP_TRUSTEE_EMAIL    = 'TrusteeEmail';     // set by trustee before first deploy
```

Both live in `getScriptProperties()`. Neither is in the Settings tab or source code.

---

## callook.info API contract

**Reference implementation:** `plans/FccLookup.gs` (ActivARES, v8 2026-04-25).

**Endpoint:** `{PROP_CALLOOK_BASE_URL}{callsign}/json` — e.g. `https://callook.info/W7ABC/json`

**Response shape (relevant fields):**
```json
{
  "status": "VALID | INVALID | UPDATING | NOT_FOUND",
  "name":   "LAST, FIRST MI  or  FIRST MI LAST",
  "current":  { "operClass": "General" },
  "previous": { "operClass": "Technician" }
}
```

**Status handling:**

| Status | Action |
|---|---|
| `VALID` | Store `FccName = data.name`. Resolve name per §reconcileOthersNames step 3c. |
| `UPDATING` | Same as `VALID`. |
| `INVALID` | Store `FccName = data.name` (if present). Store as-is — same processing as `VALID`. License validity is not the app's concern; name lookup is. |
| `NOT_FOUND` | Leave `Source = 'pending'`; do not overwrite any existing `Name` or `FccName`. Retry next Sunday. |
| Network / parse error | Treat as `NOT_FOUND`. |

**Name format:** callook.info returns `"LAST, FIRST MI"` or `"FIRST MI LAST"`. Store the raw `data.name` string in `FccName` without reformatting. The preferred `Name` is set by the NCO or trustee.

**Rate limiting:** `reconcileOthersNames` pauses 500 ms between API calls (same courtesy pattern as ActivARES `backfillFccData`). `resolveName` makes a single call — no sleep needed.

---

## Server functions

### `sundaySync()` (new, time-driven trigger)

```typescript
function sundaySync(): void
```

1. `LockService.getScriptLock().tryLock(10_000)`. If unavailable — another execution is already running — log and **return immediately**. The early-return on lock failure is the idempotency guard: a manual run-dropdown call concurrent with the trigger fires both, the second sees the lock taken and exits cleanly.
2. Read `RosterCsvDriveFolderId` from `getScriptProperties()`.
3. List files in the folder; pick the newest by `getLastUpdated()`. Operational convention: the trustee removes the prior week's file before dropping the new one so `getLastUpdated()` picks unambiguously.
4. Fetch file contents: `DriveApp.getFileById(id).getBlob().getDataAsString()`.
5. Parse via `Utilities.parseCsv()`.
6. Validate header row contains `Callsign`, `Name`, `LicenseClass` (column-name presence check only — values are not validated). On failure: email `PROP_TRUSTEE_EMAIL`, release lock, return — do NOT overwrite existing `Roster` data.
7. Clear `Roster` data rows (keep frozen header). Batch-write all three columns per row.
8. Release lock.
9. Call `reconcileOthersNames()` (intentionally outside the lock — Roster is settled before reconciliation begins).
10. Log summary.

**Trigger install:**
```typescript
function installSundaySyncTrigger(): void {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sundaySync')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sundaySync')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2)   // fires 02:00–03:00 PT; CSV guaranteed present by 01:30 PT
    .create();
}
```

Run-dropdown shims in bundle footer:
```javascript
function installSundaySyncTrigger() { NetControl.installSundaySyncTrigger(); }
function sundaySync()               { NetControl.sundaySync(); }
function reconcileOthersNames()     { NetControl.reconcileOthersNames(); }
```

---

### `reconcileOthersNames()` (new, also manually callable)

```typescript
interface ReconcileResult {
  checked:          number;
  silentlyResolved: number;
  conflicts:        number;
  skipped:          number;   // rows already at NameConflict=TRUE — not re-processed
  timedOut:         boolean;
  remaining:        number;
}

function reconcileOthersNames(): ReconcileResult
```

1. Record `startTime = Date.now()`.
2. Read all `Others` rows where `(Source === 'pending' OR Source === 'manual') AND NameConflict === FALSE`. Rows already flagged `NameConflict = TRUE` are counted in `skipped` and not re-processed — trustee has been notified; re-running FCC on them would just re-email.
3. For each row:
   a. **Time-budget check:** if `Date.now() - startTime > 270_000`, stop. Set `timedOut = true`, `remaining = unprocessedCount`. Break.
   b. If not the first call, `Utilities.sleep(500)` (callook.info rate courtesy).
   c. Call callook.info for the callsign.
   d. On failure (`NOT_FOUND`, network error): leave `Source` unchanged; row retries next Sunday.
   e. On success (any of `VALID`, `UPDATING`, `INVALID`):
      - **Acquire** `LockService.getScriptLock().tryLock(10_000)` for the write.
      - Write `FccName = data.name`.
      - If `Name` is blank → set `Name = FccName`, `Source = 'fcc'`, `NameConflict = FALSE`. (**Silent resolve.**)
      - If `Name` equals `FccName` (case-insensitive) → `Source = 'fcc'`, `NameConflict = FALSE`. (**Silent confirm.**)
      - If `Name` is set and differs from `FccName` → `NameConflict = TRUE`. (**Conflict flagged.**)
      - **Release** lock.
4. After batch: collect all `Others` rows where `NameConflict === TRUE`.
5. If any conflicts exist OR `timedOut`: email `PROP_TRUSTEE_EMAIL` a digest:
   - Conflict table: Callsign | Heard As (Name) | FCC Name
   - If `timedOut`: "Reconciliation stopped at {remaining} rows not yet processed. To continue: open Apps Script editor → run `reconcileOthersNames` from the run-dropdown."
6. Return `ReconcileResult`.

---

### `resolveName(callsign: string, checkinId: string): ResolveNameResult` (new)

```typescript
interface ResolveNameResult {
  callsign:  string;
  checkinId: string;
  name:      string | null;
  fccName:   string | null;
}
```

Called from client via `google.script.run` — runs asynchronously from the client's perspective.

1. Validate `callsign` via `isValidCallsign()`. Return `{ name: null, fccName: null }` on failure.
2. Validate `checkinId` ownership: find `Checkins` row where `CheckinsCol.CheckinID === checkinId`; read its `SessionId`; verify `Sessions` row `Status !== 'Closed'`; verify `Checkins[checkinId][CheckinsCol.Callsign] === callsign`. Return `{ name: null, fccName: null }` if any check fails.
3. **Acquire** `LockService.getScriptLock().tryLock(10_000)`.
4. Re-read `Others` row for `callsign` (within lock). If `Name` is non-blank: write that name to `Checkins[checkinId][CheckinsCol.Name]`; **release** lock; return `{ name, fccName }`. (Concurrent call already resolved it — cache hit.)
5. **Release** lock. (Must release before the HTTP call — do NOT hold the lock across network I/O.)
6. Call callook.info.
7. **Acquire** `LockService.getScriptLock().tryLock(10_000)` again for the write phase.
8. On success:
   - Upsert `Others` row: `FccName = data.name`, `Name = data.name` (if `Name` was blank), `Source = 'fcc'`, `LastActive = now`, `NameConflict = FALSE`.
   - Write `data.name` to `Checkins[checkinId][CheckinsCol.Name]`.
   - **Release** lock. Return `{ name: data.name, fccName: data.name }`.
9. On failure:
   - Upsert `Others` row: `Source = 'pending'`, `LastActive = now` (create if not exists; preserve existing `Name` if present).
   - **Release** lock. Return `{ name: null, fccName: null }`.

---

### `setManualName(callsign: string, checkinId: string, name: string): void` (new)

1. Validate `callsign` via `isValidCallsign()`. Throw on failure.
2. Validate `checkinId` ownership: find `Checkins` row by `CheckinsCol.CheckinID`; verify open session; verify `Checkins[checkinId][CheckinsCol.Callsign] === callsign`. Throw on failure.
3. Validate `name`: `.trim()` both ends; non-empty after trim; ≤ 64 chars; reject if first character is `=`, `+`, `-`, or `@` (CSV-injection guard). Throw on failure.
4. **Acquire** `LockService.getScriptLock().tryLock(10_000)`.
5. Upsert `Others` row: `Name = name`, `Source = 'manual'`, `LastActive = now`. Leave `FccName` and `NameConflict` unchanged.
6. Write `name` to `Checkins[checkinId][CheckinsCol.Name]`.
7. **Release** lock.

---

### `recordCheckin` (updated)

Existing signature unchanged. The `Others` upsert happens **inside the existing `withLock` closure** — no second lock acquisition.

New behavior when callsign is NOT found in `Roster`:
1. Write `Checkins` row normally (name blank at `CheckinsCol.Name`).
2. Look up `Others` row for `callsign` (inside existing lock):
   - **Row exists, `Name` non-blank:** write `Name` to `CheckinsCol.Name` of the new row. Update `Others.LastActive = now`. Set `resolveAsync = false`.
   - **Row exists, `Name` blank:** update `Others.LastActive = now`. Set `resolveAsync = true`.
   - **Row does not exist:** create `Others` row (`Source = 'pending'`, `LastActive = now`). Set `resolveAsync = true`.
3. Return `RecordCheckinResult` with `resolveAsync` flag.

```typescript
interface RecordCheckinResult {
  success:      boolean;
  checkinId:    string;
  resolveAsync: boolean;
}
```

---

### `endSession` (updated)

The `Others` purge happens **inside the existing `withLock` closure**, after the session is closed:
1. Read all `Others` rows.
2. Delete rows where `LastActive < (now − 13 months)`.
3. Log purge count.

---

## Client changes

### Pill UX for unresolved names

When `recordCheckin` response has `resolveAsync: true`:
1. Show a **"Searching…"** badge in the name slot via `textContent` (never `innerHTML`).
2. Fire `google.script.run.withSuccessHandler(onResolveSuccess).withFailureHandler(onResolveFailure).resolveName(callsign, checkinId)`.
3. `onResolveSuccess(result)`: if `result.name` non-null, replace pill with name via `textContent`. If null, set pill to tappable "Check back".
4. `onResolveFailure()`: set pill to tappable "Check back".
5. No client-side timeout — server call runs to natural completion; does not block the NCO.

All server-derived strings inserted into DOM via `textContent` only. `innerHTML` is forbidden for any server-derived value.

### "Check back" tap

Tapping "Check back" opens an inline form:
- Label: "Name you heard:"
- Text input (max 64 chars)
- [Save] and [Cancel]

[Save]:
1. Client optimistically replaces pill with typed name via `textContent`.
2. Fires `google.script.run.withSuccessHandler(...).withFailureHandler(onSetNameFailure).setManualName(callsign, checkinId, name)`.
3. `onSetNameFailure`: restore "Check back" pill; surface brief inline error.

[Cancel]: dismiss form, restore "Check back" pill.

---

## `setupSheets` updates

Add calls to `getOrCreateSheetWithHeader` for:
- `Others` with `OTHERS_HEADERS`
- `Settings` with `SETTINGS_HEADERS` (no rows seeded)

`SetupSheetsResult.created` union type gains `'Others'` and `'Settings'`.

**Note:** `'Others'` is already in the union type in `main.ts` but the creation call is absent. This slice adds it.

**Pre-deploy checklist:**
- Confirm `drive.readonly` scope in `appsscript.json` (first time Drive is used in this project).
- Set `PROP_CALLOOK_BASE_URL` in Script Properties (default: `https://callook.info/`).
- Set `PROP_TRUSTEE_EMAIL` in Script Properties.
- Set `PROP_ROSTER_CSV_DRIVE_FOLDER_ID` in Script Properties.
- Run `setupSheets()` to create `Others` and `Settings` tabs.
- Run `installSundaySyncTrigger()` to install the weekly trigger.

---

## Interfaces (TypeScript — complete additions for this slice)

```typescript
// Roster
export const ROSTER_HEADERS = ['Callsign','Name','LicenseClass'] as const;
export const SHEET_ROSTER   = 'Roster';
export enum RosterCol        { Callsign=0, Name=1, LicenseClass=2 }
export interface RosterEntry { callsign:string; name:string; licenseClass:string; }

// Others
export const OTHERS_HEADERS  = ['Callsign','Name','FccName','Source','NameConflict','LastActive'] as const;
export const SHEET_OTHERS    = 'Others';
export enum OthersCol        { Callsign=0, Name=1, FccName=2, Source=3, NameConflict=4, LastActive=5 }
export type OthersSource     = 'fcc' | 'manual' | 'pending';
export interface OthersEntry { callsign:string; name:string; fccName:string; source:OthersSource; nameConflict:boolean; lastActive:string; }

// Settings
export const SETTINGS_HEADERS = ['Key','Value'] as const;
export const SHEET_SETTINGS   = 'Settings';

// PropertiesService keys (additions)
export const PROP_CALLOOK_BASE_URL = 'CallookBaseUrl';
export const PROP_TRUSTEE_EMAIL    = 'TrusteeEmail';

// Server result updates
export interface ResolveNameResult   { callsign:string; checkinId:string; name:string|null; fccName:string|null; }
export interface ReconcileResult     { checked:number; silentlyResolved:number; conflicts:number; skipped:number; timedOut:boolean; remaining:number; }
export interface RecordCheckinResult { success:boolean; checkinId:string; resolveAsync:boolean; }

// Checkins — Name column appended at index 10
// CheckinsCol.Name = 10 (add to existing enum)
```

---

## Security & constraints review

- **HtmlService XSS:** All server-derived strings inserted via `textContent` only. `innerHTML` forbidden for any server-derived value.
- **SSRF:** `CallookBaseUrl` lives in `PropertiesService.getScriptProperties()`, not in the user-editable Sheet. Only the Apps Script editor (owner) can change it.
- **LockService:**
  - `sundaySync`: holds `getScriptLock` (10 s tryLock) around Roster replace (steps 1–8); releases before `reconcileOthersNames`.
  - `reconcileOthersNames`: acquires and releases `getScriptLock` per-row for the write phase only; HTTP calls happen outside the lock.
  - `resolveName`: acquires lock → re-reads → **releases** → HTTP call → **re-acquires** → writes → releases. Lock is never held across network I/O.
  - `setManualName`: acquires lock → writes → releases.
  - `recordCheckin` Others upsert: inside the existing `withLock` closure — no second lock call.
  - `endSession` Others purge: inside the existing `withLock` closure.
- **IDOR:** `resolveName` and `setManualName` both verify: (a) `checkinId` exists in `Checkins`; (b) its session is open; (c) its `Callsign` field matches the `callsign` parameter. All three checks before any write.
- **Input validation:** `setManualName` validates callsign via `isValidCallsign()`; trims both ends of `name`; enforces ≤ 64 chars; rejects CSV-injection prefix chars. `resolveName` validates callsign via `isValidCallsign()`.
- **OAuth scopes added:** `https://www.googleapis.com/auth/drive.readonly` — add to `appsscript.json` before deploy.
- **Trigger dedup:** `installSundaySyncTrigger()` loops `getProjectTriggers()` and deletes matching before installing. `tryLock(10_000)` in `sundaySync` ensures a concurrent manual invocation exits cleanly.
- **6-minute limit:** `reconcileOthersNames` checks elapsed time after each API call; stops at 270 s. Realistic throughput with 500 ms sleep + Sheet write latency: ~180–270 rows per run. Unprocessed rows are reported in the trustee digest.
- **UrlFetchApp quota:** single call per check-in for `resolveName`; batched with 500 ms sleep for `reconcileOthersNames`. Both are within quota for WashCoARES net size.

---

## Verification criteria (smoke test after deploy)

1. **Sunday-Sync golden path:** drop valid `Callsign,Name,LicenseClass` CSV in Drive folder; run `sundaySync()` from run-dropdown; verify `Roster` tab replaced with all three columns.
2. **Sunday-Sync validation guard:** drop CSV with wrong headers; verify `Roster` unchanged and trustee email sent.
3. **Idempotency guard:** run `sundaySync()` manually while trigger is also scheduled in the same hour; verify only one full execution completes (second exits on lock failure).
4. **Roster hit (no FCC call):** check in a callsign in `Roster`; verify no "Searching…" pill; verify `Others` not written; verify `licenseClass` returned in roster snapshot.
5. **Others cache hit with name:** add `Others` row with `Name = 'Test Name'`; check in that callsign; verify name appears immediately; verify `Others.LastActive` updated.
6. **FCC lookup success:** check in a callsign not in `Roster` or `Others`; verify "Searching…" pill; verify pill resolves to name; verify `Others` row created with `Source = 'fcc'`; verify `Checkins.Name` populated.
7. **FCC lookup failure:** check in a callsign unknown to callook.info; verify pill resolves to "Check back".
8. **Manual name entry:** tap "Check back"; type a name; save; verify pill updates; verify `Others.Source = 'manual'`; verify `Checkins.Name` set.
9. **IDOR guard:** call `resolveName` with a mismatched `callsign`/`checkinId` pair; verify server returns `{ name: null, fccName: null }` and no Sheet write occurs.
10. **reconcileOthersNames — silent resolve:** add `Others` row with `Source = 'pending'` and a real callsign; run `reconcileOthersNames()`; verify `Name` and `FccName` populated, `Source = 'fcc'`, `NameConflict = FALSE`.
11. **reconcileOthersNames — conflict flagged:** add `Others` row with `Source = 'manual'`, `Name = 'Harry'`, and a callsign whose callook.info name differs; run `reconcileOthersNames()`; verify `NameConflict = TRUE`; verify trustee digest email includes row.
12. **reconcileOthersNames — already-conflicted rows skipped:** run again; verify `skipped = 1`, no duplicate email for the same row.
13. **endSession purge:** add `Others` row with `LastActive` > 13 months ago; run `endSession()`; verify row purged.
14. **Trigger dedup:** call `installSundaySyncTrigger()` twice; verify only one trigger exists.
15. **drive.readonly scope:** verify no authorization error on first `sundaySync()` run.

---

## Open questions

All blocking questions from rounds 1 and 2 are resolved. Remaining items are operational config, not implementation decisions:

1. **Trustee email address:** set `PROP_TRUSTEE_EMAIL` in Script Properties before first deploy.
2. **Roster CSV Drive folder ID:** set `PROP_ROSTER_CSV_DRIVE_FOLDER_ID` in Script Properties; confirm with trustee.
3. **ActivARES CSV delivery cadence:** Brian will ensure CSV is present by 01:30 PT Sunday. Trigger fires 02:00–03:00 PT.

---

## Change log

| Date | Round | Summary |
|---|---|---|
| 2026-05-14 | 0 | Initial draft |
| 2026-05-14 | 1 | Addressed all round-1 bee findings (F1–F12, 8 ambiguities, 7 readiness gaps) + 5 user decisions |
| 2026-05-14 | 2 | Round-2 bee findings: fixed `resolveName` lock-across-HTTP bug (F3/F4 — release before HTTP, re-acquire after); fixed boolean precedence in `reconcileOthersNames` filter; clarified `recordCheckin` lock (no second acquisition — inside existing `withLock`); added per-row lock to `reconcileOthersNames`; moved `endSession` purge inside `withLock`; added callsign-equality IDOR check to `resolveName` and `setManualName`; moved `CallookBaseUrl` to PropertiesService (SSRF guard); committed `Checkins.Name` to index 10; named `PROP_CALLOOK_BASE_URL` and `PROP_TRUSTEE_EMAIL`; trimmed both ends in `setManualName`; specified `checkinId` lookup column; stated lock-fail early-return as idempotency guard; shifted trigger to `.atHour(2)`. User decisions: PropertiesService for `CallookBaseUrl`; `RosterEntry` gains `licenseClass`; trigger `.atHour(2)`; `INVALID` status stored same as `VALID`. |
