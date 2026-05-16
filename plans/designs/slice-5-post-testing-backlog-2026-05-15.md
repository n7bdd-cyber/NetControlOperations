# Slice 5 — Post-Slice-4 Testing Backlog

**Date:** 2026-05-15
**Revision:** 2026-05-15 — initial draft (all four design groups assembled)
**Source:** 12 items captured during Slice 4 smoke testing, 2026-05-15. Design sessions with Brian Darby.
**Depends on:** Slice 4 fully shipped and tested (Templates, Repeaters, Sessions, Checkins, hold-to-advance, template editor, repeater system picker, section-advance flow).

**Component design files (full detail for Groups 3 and 4):**
- Group 3 (Items 6, 8, 9): `slice-5-backlog-items-6-8-9-2026-05-15.md`
- Group 4 (Items 10, 11, 12): `slice-5-exports-nts-winlink-2026-05-15.md`

---

## Backlog summary

| ID | Item | Group | Priority | Status |
|---|---|---|---|---|
| S5-1 | Net type dropdown (Settings-driven `<select>`) | Data / Storage | HIGH | NOT STARTED |
| S5-2 | NCO location autocomplete (`<datalist>` + LRU cache) | Data / Storage | MEDIUM | NOT STARTED |
| S5-3 | Visitor check-ins from other orgs | Data / Storage | MEDIUM | NOT STARTED |
| S5-4 | End Net amber when unrecognized check-ins exist | Session Flow | HIGH | NOT STARTED |
| S5-5 | FCC ID timer display on log and credits screens | Session Flow | HIGH | NOT STARTED |
| S5-6 | Hold duration halved (1.5 s → 0.75 s) | UI / Interaction | MEDIUM | NOT STARTED |
| S5-7 | "Oops" — reopen session within 5 minutes | Session Flow | HIGH | NOT STARTED |
| S5-8 | Hold-button full-background fill (accessibility) | UI / Interaction | MEDIUM | NOT STARTED |
| S5-9 | New-net script creation wizard | UI / Interaction | LOW | NOT STARTED |
| S5-10 | ICS 309 / ICS 214 Export | Reports | HIGH | NOT STARTED |
| S5-11 | NTS Traffic Message (Practice) | Reports | MEDIUM | NOT STARTED |
| S5-12 | WinLink Practice Message | Reports | MEDIUM | NOT STARTED |

---

## Working order

Each item ends with passing verification before the next begins (per CLAUDE.md).

1. **S5-5** — FCC ID timer display (self-contained CSS/JS — fast win, unblocks testing)
2. **S5-6 + S5-8** — Hold duration and fill together (one CSS edit session; fixes timing desync)
3. **S5-4** — End Net amber (mirrors existing amber logic; straightforward)
4. **S5-7** — Oops reopen (server function + 30s countdown; critical bug-risk without it)
5. **S5-1** — Net type dropdown (Settings key required by S5-2 design)
6. **S5-2** — NCO location autocomplete (depends on Settings infrastructure from S5-1)
7. **S5-3** — Visitor check-ins (depends on roster snapshot pattern; no code deps, but tests benefit from S5-1/2 being stable first)
8. **S5-10** — ICS 309 / ICS 214 Export (post-net; no dependencies on earlier S5 items)
9. **S5-11** — NTS Practice Message (during-net; independent of S5-10 except copyPreText helper)
10. **S5-12** — WinLink Practice Message (during-net; shares copyPreText with S5-11)
11. **S5-9** — New-net wizard (largest item; last because it depends on stable repeater + template systems)

---

---

# Group 1 — Data / Storage

---

## S5-1 — Net type dropdown (Settings-driven `<select>`)

### Why

The session-start screen has a free-text `<input>` for "Net Type." Every NCO types it differently — "Weekly Practice," "weekly practice net," "WashCo ARES Weekly" — so the Sessions sheet accumulates dozens of variations that all mean the same thing. Replacing the input with a `<select>` populated from a Settings key eliminates the variation and makes historical filtering by net type practical.

---

### Scope

**In:**
- New Settings key `SETTING_NET_TYPES` — stores a JSON array of net type strings, e.g. `["Washington County ARES Weekly Practice","Washington County ARES Monthly Simplex","Hillsboro ARES Net"]`.
- `getNetTypes(): string[]` server function — reads and parses the array.
- `saveNetTypes(types: string[]): SaveNetTypesResult` server function — admin-only; writes array back.
- Replace `<input id="f-net-type">` in `screen-start` with `<select id="f-net-type-select">` populated from `getNetTypes()`.
- "Other…" option at the bottom of the select reveals a hidden `<input id="f-net-type-other">` for one-off entries.
- Admin-only "Edit net types" link on `screen-start` (or `screen-editor`) opens a simple list editor to add/remove entries.

**Out:**
- No migration of existing Session rows — historical Sessions retain their free-text values.
- No validation that the selected type matches a known list (the "Other" path allows any string).
- No per-group net type config UI (v1: shared list in Settings).

---

### TypeScript interfaces

Add to `src/server/types.ts`:

```typescript
export type SaveNetTypesResult =
  | { ok: true }
  | { ok: false; error: 'NOT_AUTHORIZED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'NOT_CONFIGURED' };
```

No new Settings tab schema changes needed — `SETTING_NET_TYPES` follows the same Key / Value row pattern already used by other settings.

---

### Server functions

#### `getNetTypes(): string[]` (new, read-only)

```
1. Read Settings tab. Find row where Key === 'NET_TYPES'.
   If not found: return [] (caller shows only "Other…" option).
2. Parse value as JSON. If parse fails: return [].
3. Return array of strings (filter out blanks).
```

#### `saveNetTypes(types: string[]): SaveNetTypesResult` (new, admin-only)

```
1. callerEmail = Session.getActiveUser().getEmail().
   If not in PROP_ADMIN_EMAILS → NOT_AUTHORIZED.
2. Validate types: array of ≤ 50 strings, each ≤ 100 chars, no empty strings.
   → INVALID_INPUT with field + reason on violation.
3. getScriptLock().tryLock(8_000). → BUSY_TRY_AGAIN if fails.
4. Read Settings tab. Find row where Key === 'NET_TYPES'.
   If found: update Value cell. If not found: appendRow(['NET_TYPES', JSON.stringify(types)]).
5. Release lock.
6. Return { ok: true }.
```

---

### Client changes

**`screen-start` changes:**

Replace:
```html
<input id="f-net-type" type="text" placeholder="Net type…">
```

With:
```html
<select id="f-net-type-select">
  <!-- populated by loadNetTypes() on screen load -->
  <option value="">— select net type —</option>
  <option value="__other__">Other…</option>
</select>
<input id="f-net-type-other" type="text" placeholder="Type net name…" hidden>
```

On `screen-start` load: call `getNetTypes()`, populate options before the "Other…" entry.

On select change: show/hide `f-net-type-other` based on whether `__other__` is selected.

On session start: read net type from `f-net-type-other.value` if `__other__` selected, else `f-net-type-select.value`. Pass as `netType` in `startSession` input (same field, no server change needed).

`NetControl` state addition:
```javascript
netTypes: [],   // string[] — populated on loadNetTypes()
```

---

### Verification criteria

1. Session-start screen shows a `<select>` for net type.
2. Dropdown options match what is in the `NET_TYPES` Settings row.
3. Selecting "Other…" reveals a free-text input. Other selections hide it.
4. Starting a session with "Other…" + typed value uses the typed value as the net type.
5. Starting a session with a dropdown selection uses that option's text as the net type.
6. `saveNetTypes` called by a non-admin returns `NOT_AUTHORIZED`.
7. `saveNetTypes` with an array containing an empty string returns `INVALID_INPUT`.
8. After `saveNetTypes`, a subsequent `getNetTypes` call returns the updated list.
9. If `NET_TYPES` key is absent from Settings, the dropdown shows only "Other…".

---

### Open questions

1. **Edit UI placement.** Admin-only "Edit net types" button — on `screen-start` (visible to admin in the session start flow) or on `screen-editor` (grouped with template admin)? `screen-editor` keeps admin tools together; `screen-start` puts it closer to where it matters.
2. **Default selection.** Should the dropdown default to the most recently used net type (stored in `sessionStorage`)? Saves one tap for repeat NCOs.

---

---

## S5-2 — NCO location autocomplete (`<datalist>` + LRU cache)

### Why

The NCO types their location on every session start ("Hillsboro," "Beaverton, OR," etc.). Because it is free-text, a given NCO types it slightly differently each time, and the Sessions history shows location variation that makes geographic analysis noisy. Adding a `<datalist>` autocomplete that remembers recently entered locations eliminates repetitive typing and nudges NCOs toward consistent strings, without removing their ability to type a one-off location.

---

### Scope

**In:**
- New Settings key `SETTING_NCO_LOCATIONS` — JSON array of up to 20 location strings in LRU order (most recently used first).
- `getNcoLocations(): string[]` server function — returns the current array.
- `recordNcoLocation(location: string): void` server function — fire-and-forget; acquires ScriptLock briefly, prepends the new location, deduplicates, truncates to 20 entries, writes back.
- `<datalist id="nco-locations-list">` attached to the existing `f-nco-location` input (no structural change to the input element).
- Client calls `getNcoLocations()` on `screen-start` load to populate the datalist.
- Client calls `recordNcoLocation()` immediately after a successful `startSession()` call (fire-and-forget; failure is silent).

**Out:**
- No UI for the admin to edit the location list directly (auto-managed via LRU; stale entries age out).
- No per-user location lists (single shared list for the spreadsheet; adequate for single-org use).

---

### TypeScript interfaces

No new interfaces — `recordNcoLocation` returns void (fire-and-forget; client does not await). The fire-and-forget call uses `.withFailureHandler(function(){})` to silence errors.

---

### Server functions

#### `getNcoLocations(): string[]` (new, read-only)

```
1. Read Settings tab. Find row where Key === 'NCO_LOCATIONS'.
   If not found: return [].
2. Parse value as JSON. If parse fails: return [].
3. Return array.
```

#### `recordNcoLocation(location: string): void` (new)

```
1. location = location.trim(). If blank: return.
2. getScriptLock().tryLock(5_000). If fails: return silently (location not recorded; not fatal).
3. Read Settings tab. Find NCO_LOCATIONS row.
4. Parse existing array (or start with []).
5. Remove any existing entry that === location (case-sensitive) to avoid duplicates.
6. Prepend location to front (most recent).
7. Truncate to 20 entries (oldest dropped).
8. Write JSON back to Settings row (update or appendRow).
9. Release lock.
```

---

### Client changes

**`screen-start`:** add `list="nco-locations-list"` attribute to `#f-nco-location`:

```html
<input id="f-nco-location" type="text" placeholder="Your location…"
       list="nco-locations-list" autocomplete="off">
<datalist id="nco-locations-list"></datalist>
```

On screen load: call `getNcoLocations()` → populate `<datalist>` with `<option value="…">` elements.

After successful `startSession`:
```javascript
google.script.run
  .withFailureHandler(function(){})
  .recordNcoLocation(NetControl.sessionState.ncoLocation);
```

---

### Verification criteria

1. `screen-start` shows location suggestions when the NCO begins typing.
2. Suggestions match the `NCO_LOCATIONS` Settings row contents.
3. After starting a session, the location entered appears at the top of the suggestions list on the next session start.
4. After 20 unique locations are recorded, the oldest entry is dropped on the next `recordNcoLocation` call.
5. Typing a location not in the list and starting a session still works (free-text is preserved).
6. `recordNcoLocation` with a blank location is a no-op.
7. If the ScriptLock cannot be acquired, the session start is not blocked (fire-and-forget failure is silent).

---

### Open questions

1. **Case sensitivity.** LRU deduplication is currently case-sensitive. If an NCO types "Hillsboro" the first time and "hillsboro" the second time, both entries are kept. Consider `location.toLowerCase()` for dedup while storing the original-case form.
2. **Session storage fallback.** Should the client cache the datalist in `sessionStorage` so it does not need a server round-trip on every session start? Low priority — `getNcoLocations()` is a fast single-row read.

---

---

## S5-3 — Visitor check-ins from other orgs

### Why

During some nets, stations from outside the primary roster check in — visiting ARES members, guest operators, or liaisons from neighboring groups. Today these callsigns get no candidate match in the suffix-based lookup and the NCO has to type the full callsign manually. Adding a secondary "others" roster as a third lookup band means visitors get the same autocomplete experience as primary members.

---

### Scope

**In:**
- New server function `getOthersSnapshot()` — mirrors `getRosterSnapshot()` but reads from the secondary roster spreadsheet (the WashCo 2026 ID `1c3PI4ZJXVBI6TqYkajGb380tS6jfC0tRoS1K5ntDo5c`), or an "Others" tab if one is defined. Returns an array of simplified entries (callsign + name).
- `NetControl.others: OtherEntry[]` + `othersLoaded: boolean` added to client state.
- `band3` added to `findCandidatesBySuffix()`: after searching primary roster (`band1`) and training data (`band2`), search `NetControl.others`. Matches flagged with `fromOthers: true`.
- Candidates from `band3` display a gray "visitor" pill badge in the candidate list (distinct from the primary green/yellow badge).
- Check-in records created from visitor candidates get a `source: 'others'` annotation (or callsign suffix `" (v)"` visible in the session sheet for NCO review).

**Out:**
- No ability to add or manage the "Others" list from within the app (maintained directly in the Sheet).
- No persistent visitor roster (visitors are looked up at session start; the list is not saved per-session).
- No distinction between different "other" orgs in v1 — all non-primary entries are "visitors."

---

### TypeScript interfaces

```typescript
export interface OtherEntry {
  callsign: string;
  name:     string;   // display name; blank if not recorded
}

export type GetOthersSnapshotResult =
  | { ok: true;  others: OtherEntry[] }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'READ_FAILED' };
```

In `index.html` candidate type — add optional flag:
```javascript
// existing candidate object, add:
fromOthers: false   // true for band3 matches
```

---

### Server function

#### `getOthersSnapshot(): GetOthersSnapshotResult` (new, read-only)

```
1. Read OTHERS_SPREADSHEET_ID from Script Properties (or use the secondary roster ID constant).
   If not set / not accessible → return NOT_CONFIGURED (non-fatal; othersLoaded = false).
2. Open spreadsheet. Read "Others" tab (or "Data_Roster" tab of the secondary spreadsheet).
3. Build OtherEntry[] from Callsign + Name columns.
4. Return { ok: true, others }.
```

Design note: If the secondary spreadsheet is inaccessible (permissions, wrong ID), `getOthersSnapshot` returns `NOT_CONFIGURED`. The client sets `othersLoaded = false` and proceeds with primary + training lookup only. This is a graceful degradation — the primary check-in flow is not blocked.

---

### Client changes

**Session start:** after `getRosterSnapshot()` and `getTrainingSnapshot()` calls return, fire `getOthersSnapshot()` in parallel. On success: `NetControl.others = result.others; NetControl.othersLoaded = true`.

**`findCandidatesBySuffix(suffix)` — band3 addition:**

```javascript
// After band2 (training data) ...
if (NetControl.othersLoaded) {
  var otherMatches = NetControl.others.filter(function(e) {
    return e.callsign.toUpperCase().endsWith(suffix.toUpperCase());
  });
  otherMatches.forEach(function(e) {
    candidates.push({
      callsign:   e.callsign,
      name:       e.name,
      fromOthers: true,
      band:       3
    });
  });
}
```

**Candidate pill rendering:** when `candidate.fromOthers === true`, add class `pill-visitor` (gray background) instead of the default member pill class.

---

### Verification criteria

1. On session start, `getOthersSnapshot()` is called. If it succeeds, `NetControl.othersLoaded === true`.
2. Typing a suffix that matches a callsign in the Others list shows that callsign as a candidate with a gray "visitor" badge.
3. Selecting a visitor candidate creates a normal check-in row. The callsign is recorded correctly.
4. Primary roster and training matches are unaffected by the visitors expansion.
5. If `getOthersSnapshot()` fails or returns `NOT_CONFIGURED`, the session start is not blocked — the NCO can still check in primary members normally.
6. A callsign that matches in both primary and Others shows only the primary match (band1 wins over band3).

---

### Open questions

1. **Source of "Others."** Is the secondary WashCo 2026 roster the right source, or should a dedicated "Others" tab be added to the primary Sheet? A dedicated tab is easier to manage but adds setup work. Secondary spreadsheet reuses existing infrastructure.
2. **Visitor annotation on check-in row.** Should visitor check-ins be annotated in the Checkins tab (e.g. a `Source` column or a `(v)` suffix) so the NCO can distinguish visitors in the post-session Sheet? Or is the in-app pill sufficient?

---

---

# Group 2 — Session Flow

---

## S5-4 — End Net amber when unrecognized check-ins exist

### Why

When the NCO is about to end the net, they may have check-ins that have no name match — the callsign was typed manually or the suffix lookup returned no result. These entries are present in the Sheet but their `Name` field is blank. Ending the net silently with unresolved entries is a data quality loss. Turning the End Net buttons amber (same visual language as the section-advance button) gives the NCO a visible cue without blocking them.

---

### Scope

**In:**
- `updateEndNetAmber()` function — mirrors `updateNextSectionAmber()`. Reads `unrecognizedCount` (or computes it from `NetControl.checkins`) and toggles `btn-amber` class on the End Net buttons.
- Applied to both End Net buttons: `#btn-end-net` (on `screen-log`) and `#btn-end-confirm` (on `screen-end`).
- Soft-warning banner on `screen-end`: `"N check-in(s) have no name match. You can still end the net — or tap Back to resolve them."` Shown when amber, hidden otherwise.
- `updateEndNetAmber()` is called whenever a check-in is added, removed, or updated.

**Out:**
- No hard block — amber is a warning, not a gate. The NCO can end through amber.
- No auto-resolution of unmatched callsigns.

---

### TypeScript interfaces

No changes.

---

### Server functions

No changes.

---

### Client changes

**New function `updateEndNetAmber()`:**

```javascript
function updateEndNetAmber() {
  var unresolved = NetControl.checkins.filter(function(c) {
    return !c.name || c.name.trim() === '';
  }).length;
  var isAmber = unresolved > 0;
  var btns = [$('btn-end-net'), $('btn-end-confirm')];
  btns.forEach(function(btn) {
    if (!btn) return;
    btn.classList.toggle('btn-amber', isAmber);
  });
  var banner = $('end-net-unresolved-banner');
  if (banner) {
    banner.hidden = !isAmber;
    banner.textContent = isAmber
      ? unresolved + ' check-in(s) have no name match. You can still end — or go back to resolve them.'
      : '';
  }
}
```

**`screen-end` HTML addition:**

```html
<div id="end-net-unresolved-banner" class="warning-banner" hidden></div>
```

**Call sites:** add `updateEndNetAmber()` to every function that modifies `NetControl.checkins` (same pattern as `updateNextSectionAmber()`).

---

### Verification criteria

1. With all check-ins resolved (all have names), End Net buttons are their default color.
2. Adding a check-in with no name match turns both End Net buttons amber.
3. Resolving the last unmatched check-in returns buttons to default color.
4. The warning banner appears on `screen-end` when amber; hidden when not amber.
5. The NCO can end the net through amber without any hard block.
6. Amber state is re-evaluated correctly after check-ins are removed.

---

### Open questions

1. **"Unrecognized" definition.** Is "unrecognized" = blank name, or = `fromRoster: false`? If a check-in was manually typed (no autocomplete match) but the NCO subsequently typed a name into the notes, should it still show amber? Recommendation: amber only when `Name` column is blank.

---

---

## S5-5 — FCC ID timer display on log and credits screens

### Why

FCC Part 97 requires amateur stations to identify by callsign every ten minutes during a net. The app already has an FCC ID timer mechanism, but the countdown is only visible on one screen. During a typical net the NCO is on `screen-log` for most of the session and on `screen-credits` for the closing. If the ID alert only appears on one screen, the NCO can miss it during the credits read.

---

### Scope

**In:**
- Two `div.fcc-id-alert` elements — one in `screen-log`, one in `screen-credits` — both updated by the same timer tick.
- `updateFccTimerDisplay()` extended to update both elements (3 additional lines).
- Tap-to-reset: tapping either FCC alert `div` calls `resetFccTimer()`, resetting the countdown.
- Alert visual: countdown text turns red and pulses when < 60 seconds remaining.

**Out:**
- No audio alert (device-permission overhead; out of scope).
- No configurable interval (10 minutes is FCC-mandated; not user-adjustable).

---

### TypeScript interfaces

No changes.

---

### Server functions

No changes.

---

### Client changes

**HTML additions:**

In `screen-log` (near the section header or bottom of screen):
```html
<div id="fcc-id-alert-log" class="fcc-id-alert" role="timer" aria-live="polite"></div>
```

In `screen-credits` (near the closing text area):
```html
<div id="fcc-id-alert-credits" class="fcc-id-alert" role="timer" aria-live="polite"></div>
```

**`updateFccTimerDisplay()` extension:**

Current function updates one element. Extend to update both IDs:

```javascript
function updateFccTimerDisplay() {
  var secsLeft = getFccSecsRemaining();
  var display  = formatFccDisplay(secsLeft);
  var isUrgent = secsLeft < 60;
  var ids      = ['fcc-id-alert-log', 'fcc-id-alert-credits'];
  ids.forEach(function(id) {
    var el = $(id);
    if (!el) return;
    el.textContent = display;
    el.classList.toggle('fcc-urgent', isUrgent);
  });
}
```

**Tap-to-reset:**

```javascript
['fcc-id-alert-log', 'fcc-id-alert-credits'].forEach(function(id) {
  var el = $(id);
  if (el) el.addEventListener('click', resetFccTimer);
});
```

---

### Verification criteria

1. FCC ID countdown is visible on `screen-log` during an open session.
2. FCC ID countdown is visible on `screen-credits` during an open session.
3. Both displays show the same countdown value at all times.
4. When < 60 seconds remain, both displays turn red (`.fcc-urgent`).
5. Tapping either display resets the countdown to 10:00.
6. After resetting, both displays reflect the reset time immediately.

---

### Open questions

None. This is a targeted extension of an existing function.

---

---

## S5-7 — "Oops" — reopen session within 5 minutes

### Why

An NCO accidentally taps "End Net" and confirms. The session is now closed in the Sheet. Today the only recovery is to manually edit the Sheet — set Status back to `OPEN`, delete the EndTimestamp — which is error-prone and requires Sheet access mid-session. A 30-second "Oops" button on the post-net summary screen, backed by a server-side 5-minute recency guard, gives the NCO a safe recovery path without requiring manual Sheet edits.

---

### Scope

**In:**
- New server function `reopenSession(input: ReopenSessionInput): ReopenSessionResult`.
- 5-minute recency guard on the server: if the session's EndTimestamp is more than 5 minutes ago, reopen is rejected.
- `btn-oops` button on `screen-summary` — visible for 30 seconds after `endSession` returns `ok: true`.
- 30-second countdown displayed on `btn-oops` (e.g., "Oops! Undo (27s)").
- `onOops()` client function — calls `reopenSession`; on success navigates back to `screen-log`.
- **Critical invariant:** `onEndConfirm()` does NOT call `resetSessionLocalState()` before transitioning to `screen-summary`. All session state (sessionId, checkins array, current section index) must survive in memory for the reopen path.

**Out:**
- Reopen after 5 minutes — rejected server-side. Manual Sheet edit is the recovery path for stale sessions.
- Reopen from a different device or browser tab — not supported (client state is in-memory only).
- Multiple successive reopens — only one reopen per session is supported; after a successful reopen the Oops button is not shown again if the NCO ends the net a second time.

---

### TypeScript interfaces

```typescript
export interface ReopenSessionInput {
  sessionId: string;
}

export type ReopenSessionResult =
  | { ok: true }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_ALREADY_OPEN' }
  | { ok: false; error: 'TOO_LATE' }            // EndTimestamp > 5 minutes ago
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' };
```

---

### Server function

#### `reopenSession(input: ReopenSessionInput): ReopenSessionResult` (new)

```
1. Validate sessionId: non-empty, ≤ MAX_ID_FIELD. → INVALID_INPUT if not.
2. getSpreadsheetOrNull(). → NOT_CONFIGURED if null.
3. Read Sessions tab. Find row where SessionID === input.sessionId.
   → SESSION_NOT_FOUND if not found.
4. If Status !== SESSION_STATUS_CLOSED → SESSION_ALREADY_OPEN.
5. Parse EndTimestamp. If (now - EndTimestamp) > 5 minutes → TOO_LATE.
6. getScriptLock().tryLock(8_000). → BUSY_TRY_AGAIN if fails.
7. Update row: Status = SESSION_STATUS_OPEN, EndTimestamp = '' (blank), clear checkinCount / uniqueCallsignCount fields.
8. Release lock.
9. Return { ok: true }.
```

---

### Client changes

**`screen-summary` HTML addition:**

```html
<button id="btn-oops" type="button" class="secondary" hidden>
  Oops! Undo (<span id="oops-countdown">30</span>s)
</button>
```

**`onEndConfirm()` guard — critical:**

Remove or defer the `resetSessionLocalState()` call until AFTER the 30-second Oops window expires. Sequence on End Net confirm:

```
1. Call endSession(). Await result.
2. If ok: true →
   a. Show screen-summary (with btn-oops visible).
   b. Start 30-second Oops countdown.
   c. After 30s: hide btn-oops, then call resetSessionLocalState().
3. If ok: false → show error; stay on screen-end.
```

**`onOops()` client function:**

```javascript
function onOops() {
  clearOopsCountdown();
  $('btn-oops').disabled = true;
  google.script.run
    .withSuccessHandler(function(result) {
      if (result.ok) {
        showScreen('screen-log');
        // session state still in memory; log screen re-renders from existing state
      } else {
        toast('Could not reopen: ' + result.error);
        $('btn-oops').hidden = true;
        resetSessionLocalState();
      }
    })
    .withFailureHandler(function(err) {
      toast('Server error: ' + (err.message || 'unknown'));
      $('btn-oops').disabled = false;
    })
    .reopenSession({ sessionId: NetControl.sessionState.sessionId });
}
```

---

### Verification criteria

1. After `endSession` succeeds, `btn-oops` is visible on `screen-summary` with a 30-second countdown.
2. Tapping "Oops! Undo (Ns)" calls `reopenSession` and returns to `screen-log` with the check-in list intact.
3. After 30 seconds without tapping Oops, the button disappears and `resetSessionLocalState()` is called.
4. After a successful reopen, ending the net again does NOT show the Oops button (second-end guard).
5. Calling `reopenSession` with a session closed more than 5 minutes ago returns `TOO_LATE`; client shows toast and hides the button.
6. Server test: `reopenSession` on an open session returns `SESSION_ALREADY_OPEN`.
7. Server test: `reopenSession` on an unknown session ID returns `SESSION_NOT_FOUND`.
8. Check-in list on `screen-log` is identical before and after a reopen (no state lost during the End → Oops flow).

---

### Open questions

1. **State for multi-device.** What if the NCO ends the net on device A and tries to Oops on device B? Device B has no in-memory session state. The server reopen would succeed but the log screen would be empty. Recommendation: scope to same-device only in v1; document in release notes.
2. **Second reopen.** After one successful Oops, should the button be suppressed permanently for the session? Or re-shown if the NCO ends a second time? Recommendation: suppress after first Oops to avoid confusion.

---

---

# Group 3 — UI / Interaction

**Full detailed designs in:** `slice-5-backlog-items-6-8-9-2026-05-15.md`

This section summarizes the key decisions for each item. Read the component file for complete TypeScript interfaces, exact CSS/JS snippets, and full verification criteria.

---

## S5-6 — Hold duration halved (1.5 s → 0.75 s)

### Why

The 1.5-second hold is longer than necessary for NCOs who know the gesture. Halving to 0.75 s cuts the interruption without removing the accidental-tap guard.

### Key decisions

- **Three locations must move together** or the visual fill desync from the timer:
  1. `.hold-btn.holding::after` CSS transition: `1.5s linear` → `0.75s linear`
  2. `setupHoldButton` JS timer: `1500` → `750`
  3. `loadTemplateIntoEditor` tooltip: `'Hold 1.5 s to delete'` → `'Hold 0.75 s to delete'`
- The `1500` in the `callWithRetry` backoff array is **unrelated** — do not change it.
- Both `btn-next-section` and `btn-delete-template` inherit the change automatically via `setupHoldButton` and `.hold-btn`.

**See component file for exact line locations and verification criteria.**

---

## S5-8 — Hold-button full-background fill (accessibility)

### Why

The current 4 px bottom strip is too subtle for users with low contrast sensitivity. Full-height fill from left to right is unmistakable as a progress indicator and meets WCAG 2.1 SC 1.4.11 spirit.

### Key decisions

- Replace `height: 4px; bottom: 0` with `height: 100%; top: 0` on `::after`.
- Fill color: `rgba(255,255,255,0.30)` — calculated to maintain ≥ 4.6:1 contrast against white text on all three button background colors (blue `#0b69d3`, gray `#777`, amber `#b07d00`).
- `z-index: 0` on `::after` + `.hold-btn > * { position: relative; z-index: 1; }` — prevents fill from covering label text in Chrome on Android.
- `pointer-events: none` on `::after` — fill does not intercept pointer events that drive the hold timer.
- Apply **after S5-6** — the transition duration in the replacement CSS is `0.75s`.

**Open questions:** opacity tuning on amber state; Safari `::after` z-index behavior.

**See component file for exact CSS replacement block and full verification criteria.**

---

## S5-9 — New-net script creation wizard

### Why

The current "New Script" path drops the admin into a blank form. First-time trustees have no scaffolding. The wizard guides them through six steps and produces both a `NetTemplate` and the associated `RepeaterEntry` rows in one flow.

### Key decisions

- **Six steps:** Name/type, Repeaters, Preamble (with chip bar), Sections (reuses free-form editor pattern), Closing credits (with chip bar), Review + Save.
- **New server function `saveRepeaterSystem`** — batch upsert: soft-deactivates old rows for the same system name, appends new rows. Admin-only. ScriptLock.
- **Step 2 constraints:** exactly one Primary row; max 4 Alternates. Link entries (EchoLink, etc.) out of scope for wizard.
- **Steps 3 and 5:** reuse existing `renderChipBar` + `SCRIPT_CHIP_VARS` without modification.
- **Step 6 (Save):** two sequential server calls — `saveRepeaterSystem` first, then `saveTemplate`. Distinct retry if only one succeeds.
- **`WizardState`** is a new client object initialized fresh on each wizard open; not persisted.
- **`ALL_SCREENS`** gains `'screen-wizard'`.
- Wizard does not replace the free-form editor; it is a create-only bootstrap path.

**Open questions:** system-name collision warning; "Use Wizard" vs "+ New Script" placement; focus management for keyboard/screen-reader; starter section set for different net types.

**See component file for full TypeScript interfaces, `saveRepeaterSystem` pseudocode, HTML structure, and 40+ verification criteria.**

---

---

# Group 4 — Reports

**Full detailed designs in:** `slice-5-exports-nts-winlink-2026-05-15.md`

This section summarizes the key decisions for each item. Read the component file for complete TypeScript interfaces, server function pseudocode, plain-text formatting specs, and full verification criteria.

---

## S5-10 — ICS 309 / ICS 214 Export

### Why

After the net closes, the NCO must file an ICS 309 (Communications Log) and ICS 214 (Activity Log) for any session that counts toward served-agency training hours. Today this is manual copy-paste from the Sheet. This feature generates both forms as formatted plain text on the post-net summary screen.

### Key decisions

- **`getIcsExport(sessionId)`** — read-only; no LockService; blocked by `SESSION_NOT_CLOSED` guard.
- **One server call returns both forms:** structured payload objects (`ics309`, `ics214`) plus pre-formatted plain-text strings. Structured objects kept for a future v2 Google Docs path.
- **New `screen-ics`** with `<pre>` blocks, "Copy ICS 309" and "Copy ICS 214" buttons (Clipboard API + select-all fallback), "← Back to Summary."
- **Frequency resolution:** primary repeater from Repeaters tab if RepeaterSystem was selected; falls back to legacy free-text Repeater field; blank if neither.
- **ICS 309 station log:** one row per Checkins entry, sorted by `FirstTimestamp`. `TapCount > 1` → "Check-in (×N)".
- **ICS 214 activity log (v1):** two synthetic rows — net-open and net-close. Section-tagged rows deferred to Net Script v2; interface designed to accept them without structural change.
- **`copyPreText` / `selectPreText` helper** defined in this item; shared by S5-11 and S5-12.
- **No Drive scope needed** — all output is in-page text.
- `ALL_SCREENS` gains `'screen-ics'`.

**Open questions:** Home Agency hard-coded ("Washington County ARES"); Mode hard-coded ("FM"); v2 Google Docs output scope; `Session.getScriptTimeZone()` verification.

**See component file for full TypeScript interfaces, plain-text column-width layout spec, and 16 verification criteria.**

---

## S5-11 — NTS Traffic Message (Practice)

### Why

Handling NTS (National Traffic System) traffic is a core ARES training objective. This feature generates a properly formatted ARRL NTS practice message auto-populated from the session, displayed on screen so the NCO can read it on air without preparation.

### Key decisions

- **`getNtsPracticeMessage(sessionId)`** — read-only; `SESSION_CLOSED` guard (message is for live on-air use only; not post-net archiving).
- **All six NTS message groups** per ARRL NTS Methods and Practices Guidelines. Precedence: `ROUTINE` (hard-coded).
- **Message number:** `{first-6-chars-of-sessionId}-001` — session-scoped; no NTS registry filing.
- **ARL Check (word count):** computed server-side, excluding terminal "END." marker. Client displays without re-counting.
- **`formattedText`** laid out in on-air reading order with labeled groups and pause markers so the NCO reads straight off the screen.
- **New `screen-nts`** with "← Back to Net" returning to `screen-log` without ending the session. Session stays open.
- `ALL_SCREENS` gains `'screen-nts'`.
- Reuses `copyPreText` helper from S5-10.

**Open questions:** Addressee city/state/zip hard-coded ("HILLSBORO OR 97123"); single precedence level; ARL-coded messages deferred; HXG handling instructions deferred.

**See component file for full NTS field definitions table, TypeScript interfaces, and 14 verification criteria.**

---

## S5-12 — WinLink Practice Message

### Why

Winlink sends are a common ARES training activity during nets. Today the NCO verbally dictates a Winlink message. This feature generates a complete Winlink-formatted practice message so the NCO can read the headers and body on air and participants can copy directly into Winlink Express.

### Key decisions

- **`getWinlinkPracticeMessage(sessionId)`** — read-only; `SESSION_CLOSED` guard.
- **To address:** `W6BA@winlink.org` (hard-coded publicly documented Winlink test address).
- **No actual transmission** — server generates display text only; no `UrlFetchApp` calls.
- **Step-by-step instructions** for participants included in `formattedText` so less-experienced members can follow along.
- **Timezone offset `-0700`** (PDT) is noted as a v2 fix; has no operational effect since Winlink Express sets its own timestamp on send.
- **New `screen-winlink`** parallels `screen-nts` in structure. Reuses `copyPreText` helper from S5-10.
- `ALL_SCREENS` gains `'screen-winlink'`.

**Open questions:** gateway address configurability (Settings tab key in v2); P2P vs. gateway mode; reply tracking.

**See component file for full Winlink field definitions, TypeScript interfaces, and 12 verification criteria.**

---

---

## `ALL_SCREENS` after Slice 5

Currently 7 screens. After all items are implemented:

```javascript
var ALL_SCREENS = [
  'screen-start',    // session setup
  'screen-preamble', // preamble read
  'screen-log',      // check-in logging
  'screen-credits',  // closing credits
  'screen-end',      // end net confirmation
  'screen-summary',  // post-net summary
  'screen-editor',   // template manager
  'screen-wizard',   // S5-9: new-net wizard
  'screen-ics',      // S5-10: ICS 309/214 export
  'screen-nts',      // S5-11: NTS practice message
  'screen-winlink',  // S5-12: WinLink practice message
];
```

---

## `NetControl` state additions (accumulated across all Slice 5 items)

```javascript
// S5-1
netTypes:        [],    // string[] from getNetTypes()

// S5-3
others:          [],    // OtherEntry[] from getOthersSnapshot()
othersLoaded:    false,

// S5-10
icsExportPayload: null, // IcsExportPayload | null

// S5-11
ntsMessage:      null,  // NtsMessage | null

// S5-12
winlinkMessage:  null,  // WinlinkMessage | null
```

---

## Change log

| Date | Round | Summary |
|---|---|---|
| 2026-05-15 | 0 | Initial draft — all 12 items assembled from 4 design-bee sessions |
