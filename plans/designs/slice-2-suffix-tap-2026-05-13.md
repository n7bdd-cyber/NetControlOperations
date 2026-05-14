# Design Doc: Slice 2 — Suffix-Tap (stub roster + lookup + candidate list)

**Date:** 2026-05-13
**Revision:** 2026-05-13 — round 3 (addresses 17 critic + 27 readiness items from round 1, then 15 critic items from round 2; round-2 readiness passed at zero open questions — change log at the end of this doc)
**Source:** `/eg-new-feature Suffix-Tap` against [`plans/prds/washcoares-nco-checkin-logger-2026-05-12.md`](../prds/washcoares-nco-checkin-logger-2026-05-12.md)
**Implements PRD FRs:** FR-2 (Roster snapshot, server function — **narrower signature than PRD FR-2 specifies; see §Interfaces for the divergence**), FR-3 (Suffix-Tap resolution, client-side — text-input subset).

**PRD FR-2 signature divergence.** PRD §121 specifies `getRosterSnapshot(asOfTimestamp)` returning `Roster + RosterFallback` with a `RosterVersion` for cache invalidation. Slice 2's `getRosterSnapshot(): GetRosterSnapshotResult` takes no parameter, returns only `Roster`, and has no version field. Rationale: Slice 2 defers `RosterFallback` (FR-5/FR-6) and IndexedDB caching (PWA slice). Without a cache, there is no need for a version field; without `RosterFallback`, there is no need for the union return. When IndexedDB lands, the signature will widen to add `asOfTimestamp: number` and a `version: number` discriminant.
**Defers PRD FRs:** FR-5 (Unknown-callsign queue), FR-6 (Async FCC resolver), FR-7 (Undo / edit-on-tap), FR-8 (List virtualization), FR-9 email (Sheet-write half already in Slice 1), FR-10 (Backfill), FR-11 (Sunday-Sync trigger — `Roster` populated by hand in Slice 2), FR-12 (Monthly trigger), FR-13 (5-year purge), FR-14 (Access-mode toggle UX), FR-15 (Conflict toast), FR-16 (Multi-NCO handoff). Suffix-Tap **thumb-zone numeric keypad** UX is also deferred — Slice 2 enhances the existing text input with candidate-list lookup; the keypad is a later sub-slice.

---

## Why

The Slice 1 smoke test on 2026-05-13 surfaced the UX gap that motivates Slice 2: a user typing only the suffix portion of a callsign (e.g. `ABC`) had no system feedback that this wasn't a full callsign. The `/eg-fix-bug` patch landed in `e03b512` papers over the gap with a "Type the full callsign — Suffix-Tap isn't built yet" inline error. Slice 2 replaces that error with actual Suffix-Tap behavior: type a 1-3-letter suffix → see candidate callsigns from the roster → tap one to LOG. This is the highest-leverage next slice because the NCO mental model the user reported ("type a suffix, get prompted") is the model PRD FR-3 already specifies — the bug fix message is a placeholder for this slice.

---

## Scope

**In:**
- New `Roster` Sheet tab schema, created by an updated `setupSheets`.
- New read-only server entry point `getRosterSnapshot()`.
- New client state: `NetControl.roster: RosterEntry[]`, `NetControl.rosterLoadError: boolean`.
- New client function `findCandidatesBySuffix(suffix)` — pure logic, in-memory filter.
- Update to client `onLog()` flow: full callsign → existing LOG path; suffix-only → candidate-list branch (replaces the bug-fix "Type the full callsign" inline error).
- New UI section: candidate list, vertical column of large tap targets (≥48 px), each row showing callsign + name; tap commits via the existing `recordCheckin` path.
- An Escape / cancel control to dismiss the candidate list and continue typing.
- "Priority order" implementation per PRD FR-3 (Slice 2 cut: `recent-this-net` → `Roster`; `RosterFallback` and `UnknownCallsigns-this-net` are still empty — those tabs don't exist until later slices).

**Out (deferred, with target slice noted):**
- **Thumb-zone numeric keypad UI** (Slice 2b or 3) — PRD's "Logging" screen vision but a distinct UX surface.
- **IndexedDB cache for the roster snapshot** (Slice 4+, alongside PWA / offline) — Slice 2 keeps the in-memory model from Slice 1.
- **Sunday-Sync time trigger + Drive CSV pipeline** (FR-11, Slice 3) — Brian populates `Roster` manually for Slice 2's smoke test.
- **Unknown-callsign queue and `RosterFallback` tab** (FR-5/FR-6, later slice) — Slice 2's lookup only consults Roster + recent-this-net.
- **Async FCC/HamDB resolver** (FR-6, later slice).
- **Snapshot version metadata / cache invalidation** — the snapshot is fetched fresh on every session start in Slice 2; no version field needed yet.
- **≤200 ms perceived performance target** (PRD §155) — not measurable until IndexedDB lands; Slice 2's snapshot fetch is one `getDataRange().getValues()` call which is plenty fast for the WashCoARES roster ceiling but is not the production architecture.
- **Roster admin UI** — Brian edits the `Roster` tab in the Sheet directly.

---

## Surfaces touched

| Surface | Change |
|---|---|
| `src/server/types.ts` | Add `SHEET_ROSTER = 'Roster'`, `ROSTER_HEADERS`, `RosterCol` enum, `RosterEntry` interface, `GetRosterSnapshotResult` discriminated union with `'NOT_CONFIGURED'` and `'READ_FAILED'` error variants. **Widen `SetupSheetsResult.created` from `('Sessions' \| 'Checkins')[]` to `('Sessions' \| 'Checkins' \| 'Roster' \| 'Others')[]`**. Tab semantics: `'Roster'` = ActivARES-member tab (populated by Sunday-Sync in Slice 3); `'Others'` = future tab for non-member callsigns the NCO logs during a net (visitors, drop-ins, unresolved callsigns). Slice 2 does not yet create the `'Others'` tab; the literal is in the union ahead of the slice that wires it up so the type stays stable when that slice lands. |
| `src/server/main.ts` | `setupSheets` also creates the Roster tab. New exported `getRosterSnapshot()` entry point. |
| `src/server/sheets.ts` | Unchanged — existing `getOrCreateSheetWithHeader` and `getSheetOrNull` are reused. |
| `src/server/validators.ts` | Unchanged — existing `isLikelySuffixOnly` and `isValidCallsign` (post bug-fix) are reused. |
| `scripts/build.mjs` | Add `getRosterSnapshot` to the explicit function-shim list in the bundle footer (so the Apps Script editor's static run-dropdown picks it up, same pattern as the Slice 1 build-fix). |
| `src/html/index.html` | (a) New hidden `<div id="candidates-row">` block inside `#screen-log` (NOT a new screen). (b) `NetControl` object adds `roster: []` and `rosterLoadError: false` fields — **must also be added to the `NetControl = {...}` reset literal in `onNewNet` so they re-initialize on every new session start.** (c) `onStart` flow chains a `getRosterSnapshot` call (via `callWithRetry`) after `startSession` succeeds; promise tail attaches `.catch(() => { NetControl.rosterLoadError = true; })` so unhandled rejections don't strand the UI. (d) `onLog` branches: full-callsign → existing LOG path; suffix-only → mint `eventId` and stash in `inFlightCheckin`, then `findCandidatesBySuffix` → render candidates OR inline-error in `#e-callsign`. The candidate list is **only rendered on LOG button / Enter, never on keystroke** — no debounce, no live-suggest. (e) New `onCandidateTap(callsign)` that LOGs the full callsign via the existing `recordCheckin` path, reusing the `inFlightCheckin.eventId` minted by the suffix-only branch in (d). (f) New `dismissCandidates()` bound to (i) Escape `keydown` listener attached to `#candidates-row` on show + removed on hide, and (ii) the `#btn-candidates-cancel` button's `click`. Both restore focus to `#f-callsign`. (g) CSS for candidate-list rows (`.candidate { min-height: 48px; ... }` for WCAG tap-target). |
| `tests/main.test.ts` | New `describe('getRosterSnapshot', ...)`: empty case, populated case, NOT_CONFIGURED, malformed-row filtering. Updated `setupSheets` idempotency tests to expect 3 created tabs first run (Sessions + Checkins + Roster) and 0 on re-run. |
| `tests/validators.test.ts` | Unchanged. |
| `tests/sheets.test.ts` | May need a new `getOrCreateSheetWithHeader` test for Roster header shape, OR existing parameterized tests cover it — TBD on implementation. |
| `appsscript.json` (repo root) | Unchanged — no new OAuth scope. |

---

## Interfaces

### Sheet schema: `Roster` tab

| Col | Header | Type | Notes |
|---|---|---|---|
| A | Callsign | string | Required. Uppercase, primary key. Must pass `isValidCallsign` (FCC US shape — `[A-Z]{1,2}[0-9][A-Z]{1,3}` etc., per the Slice-1.5 bug fix). |
| B | Name | string | Optional. Free-form display (e.g. `"Darby, Brian"`). |
| C | LastActive | string | Optional. ISO date (`YYYY-MM-DD`) of the last net the callsign appeared in. Blank for stub data in Slice 2; Sunday-Sync (Slice 3) will populate it. |

```ts
// types.ts (additions)
export const SHEET_ROSTER = 'Roster';
export const ROSTER_HEADERS = ['Callsign', 'Name', 'LastActive'];
export const RosterCol = { Callsign: 0, Name: 1, LastActive: 2 } as const;

export interface RosterEntry {
  callsign: string;
  name: string;       // may be empty string
  lastActive: string; // ISO date or empty string — Slice 2 trusts whatever is in cell C and does NOT validate the shape; Sunday-Sync (Slice 3) writes well-formed values
}

export type GetRosterSnapshotResult =
  | { ok: true; roster: RosterEntry[] }
  | { ok: false; error: 'NOT_CONFIGURED' }    // Spreadsheet or Roster tab missing
  | { ok: false; error: 'READ_FAILED' };      // Sheet read threw (quota, transient API error, malformed Sheet)

// types.ts (existing — widening, NOT a new declaration)
// Previously: created: ('Sessions' | 'Checkins')[]
// After:      created: ('Sessions' | 'Checkins' | 'Roster')[]
```

### Server function

```ts
// main.ts (new entry point)
export function getRosterSnapshot(): GetRosterSnapshotResult;
```

- **No input.**
- **No `LockService`** — read-only. Project convention (this slice formalizes it): `withLock` is for write paths only; pure-read entry points omit it to keep them fast and to leave the script lock available for the write path. Sunday-Sync's eventual writes WILL hold the lock; a concurrent read here can race the snapshot mid-write and the worst case is missing a row added in the last few milliseconds — accepted.
- **No admin gate.** `getRosterSnapshot` is unauthenticated by design: callsigns and names are FCC-public per PRD §161 ("callsign-on-the-air is already public per the FCC"). Adding an auth gate here would expand the deployment to `executeAs: USER_DEPLOYING` or require explicit allowlisting, neither of which fits Slice 2's scope. **Scraping trade-off acknowledged:** the WashCoARES-curated subset (which callsigns are members + the chosen display names) has slightly more value than raw FCC data, and the deployed `/dev` and `/exec` URLs are reachable by any signed-in Google account. We accept this for v0 — the membership population is small, the URL is obscure rather than public, and adding rate-limiting / per-user auth is a meaningful complexity tax for a marginal information-leak risk. Revisit if WashCoARES wants the membership list private.
- **Read path:**
  1. `ss = getSpreadsheetOrNull()` — if null, return `{ok: false, error: 'NOT_CONFIGURED'}`.
  2. `sheet = getSheetOrNull(ss, SHEET_ROSTER)` — if null, same.
  3. **Wrap `Sheet.getDataRange().getValues()` in `try/catch`.** On exception, `Logger.log` the error and return `{ok: false, error: 'READ_FAILED'}`.
  4. For each data row (header at index 0 skipped), **wrap the per-row body in an inner `try/catch`** so one bad row does not blow up the whole snapshot. On row-level catch, `Logger.log` `"getRosterSnapshot: row N threw: <message>"` and continue with the next row.
     - Read `row[RosterCol.Callsign]`, trim. If empty → **silent skip** (this is the trailing-blank-row case; no warning).
     - If the trimmed callsign does NOT pass `isValidCallsign` → `Logger.log` ONE line (`"getRosterSnapshot: skipping malformed row N: <callsign-as-typed>"`) and skip. The test does NOT assert log output; it asserts the row is absent from the result.
     - Read `row[RosterCol.Name]` and `row[RosterCol.LastActive]`, coerce to string (defending against numeric or Date cells), trim.
     - Push `{ callsign, name, lastActive }`.
  5. **Dedup by callsign**: if two rows survive validation with the same callsign, **last-write-wins on row order** (later row overwrites earlier). Documented so PRD-Slice-3 (Sunday-Sync) can rely on this when designing dedup behavior in the CSV import.
  6. Return `{ok: true, roster: [...] }`.

**`RosterCol` IS used** in the read path (`row[RosterCol.Callsign]`, etc.) — it's not declared-but-unused.

### Client state additions (inside `NetControl`)

```js
roster: [],            // RosterEntry[] | empty until startSession completes the snapshot fetch
rosterLoadError: false,// true if getRosterSnapshot returned NOT_CONFIGURED or failed at network layer
```

Both fields are reset to `[]` / `false` at session start and on End Net.

### Client functions

```js
// PRD FR-3 priority order (Slice 2 cut: bands 1+2 only; bands 3+4 defer).
//
// Returns the first 10 entries in priority order from the union of:
//   Band 1 — recent-this-net: ITERATE NetControl.history (which is the
//            newest-first array of callsigns the existing onLog success path
//            maintains). For each callsign in history, IF it is still in
//            NetControl.checkins (no one removed it) AND it endsWith(suffix),
//            include it in band 1. Yields newest-first ordering naturally.
//   Band 2 — Roster: NetControl.roster entries matched by endsWith(suffix), EXCLUDING
//            any callsign already in band 1. INTRA-BAND ORDER: declaration order
//            (preserves what getRosterSnapshot returned, which preserves Sheet row
//            order, which Sunday-Sync will eventually preserve as roster-update order).
//
// Match rule: callsign.endsWith(suffix). Suffix is uppercased by onLog before this
// fn is called; roster callsigns are uppercased by getRosterSnapshot's validator
// filter; so the comparison is effectively case-sensitive on already-uppercased
// data. The case-insensitivity claim is belt-and-suspenders documentation against
// a future regression in either side; keep it.
//
// Name lookup for band-1 (recent-this-net) entries: NetControl.checkins does NOT
// store the name. Look up the matching RosterEntry by callsign in NetControl.roster.
// If not found in roster (e.g. NCO logged a full callsign that isn't in the
// roster), the candidate row renders callsign-only.
//
// KH6/W7ABC and endsWith: `"KH6/W7ABC".endsWith("ABC")` is true. Slice 2 lets
// slash-prefixed roster entries match suffix-only typing. If this proves
// surprising in practice, revisit in a later slice (specialized "split on slash,
// match the base" rule).
function findCandidatesBySuffix(suffix) {
  // ... per the contract above. Returns RosterEntry[].
}

function renderCandidates(candidates) {
  // 1. Populate #candidates-list under #candidates-row with the rows below.
  // 2. Update #candidates-prompt's textContent to include the count, e.g.
  //    "Suffix matches: 3 found." This element carries aria-live="polite"
  //    (see §ARIA strategy) so screen readers announce the count when the
  //    section becomes visible.
  // 3. Show #candidates-row (remove the `hidden` attribute).
  // 4. Disable #btn-log via `$('btn-log').disabled = true`.
  // 5. Native-focus the first <button class="candidate"> via .focus().
  //
  // Row HTML (semantic, NOT role="listbox" — listbox semantics imply roving-tabindex
  // with aria-activedescendant, which is more complex than this UI needs):
  //   <li><button class="candidate" data-callsign="W7ABC">
  //     W7ABC — Darby, Brian
  //     <span class="recent-badge">this net</span>   <!-- only if band 1 -->
  //   </button></li>
  // When Name is empty string: render "W7ABC" only — NO trailing dash or space.
  // First button receives native focus on render so the keyboard user can press
  // Enter to commit the top candidate; Tab to cycle.
  // Includes a #btn-candidates-cancel below the list with text "Cancel — keep typing".
}

function onCandidateTap(callsign) {
  // Calls recordCheckin with the full callsign, reusing the eventId minted by
  // onLog's suffix-only branch (stashed in NetControl.inFlightCheckin). This
  // preserves the existing retry-without-double-log invariant. On success:
  // hide #candidates-row, re-enable #btn-log via `disabled = false`, clear
  // input, focus input, null out inFlightCheckin (already done by the existing
  // success path).
}

function dismissCandidates() {
  // 1. Hide #candidates-row (set the `hidden` attribute).
  // 2. Re-enable #btn-log via `$('btn-log').disabled = false`.
  // 3. KEEP current #f-callsign value.
  // 4. Restore focus to #f-callsign.
  // 5. Null out NetControl.inFlightCheckin so the next LOG mints a fresh eventId.
  // Bound to:
  //   (a) Escape keydown listener on `document`, ATTACHED on render and
  //       REMOVED on dismiss. Why document-level: #candidates-row is a <div>
  //       (not focusable), so a keydown listener on it only fires while a
  //       descendant has focus. If the user clicks elsewhere on the page,
  //       Escape would stop working. Listening on `document` is robust across
  //       focus loss; the listener checks `!$('candidates-row').hidden` before
  //       firing dismiss so it's a no-op when the candidate list isn't up.
  //   (b) #btn-candidates-cancel click handler.
}
```

### `setupSheets` change

`setupSheets` continues to return `{ok: true, created: string[]}` but `created` can now contain `'Sessions'`, `'Checkins'`, AND/OR `'Roster'`. The existing return-shape consumers (none in Slice 1's client; tests only) keep working.

---

## UX flow (click-by-click)

1. NCO opens `/dev` URL — same as Slice 1.
2. NCO fills the Start form, clicks **Start Session** — same as Slice 1.
3. **NEW:** Immediately after the `startSession` server call returns `{ok: true}`, `onStart` calls `getRosterSnapshot()` via `callWithRetry` (same retry semantics as `startSession`). The call is **fire-and-forget from the screen-switch perspective** — `showScreen('screen-log')` does NOT await the snapshot, so the Logging screen appears immediately. The snapshot promise's `.then` populates `NetControl.roster`; the promise's `.catch(() => { NetControl.rosterLoadError = true; })` ensures unhandled rejection sets the error flag rather than stranding the UI in the in-flight state. On `{ok: false}` responses, `rosterLoadError` is also set true (any of `NOT_CONFIGURED`, `READ_FAILED` triggers the flag — they're semantically identical for the client: "no usable roster").
4. The Logging screen appears — same as Slice 1.
5. NCO types in the callsign input.  **The candidate list is rendered only when the user clicks LOG (or presses Enter) — never on keystroke.** No live-suggest, no debouncer. On the LOG / Enter event, after `validCallsign(raw)` and `isLikelySuffixOnly(raw)` checks:
   - **Full callsign** (e.g. `W7ABC`): `validCallsign(raw)` is true → existing LOG submit path. No change. Full-callsign LOG **never** waits on the snapshot.
   - **Suffix-only** (e.g. `ABC`, 1-3 ALL-CAPS letters, no digit):
     - **Mint an `eventId`** and stash it in `NetControl.inFlightCheckin = { eventId, callsign: null }` (callsign is null until the user picks one from the list — preserves the existing retry-without-double-log invariant).
     - If `NetControl.rosterLoadError` is true → inline error in `#e-callsign`: `"Roster unavailable — type the full callsign (e.g. W7ABC)."` Clear `inFlightCheckin`. (Note: this REPLACES the Slice 1.5 bug-fix message at `src/html/index.html:424` — `"Type the full callsign (e.g. W7ABC) — Suffix-Tap isn't built yet."` The implementation must delete the old string when wiring this branch. The new wording is more specific because Suffix-Tap IS now built; the only reason for the message is that the roster is unreachable.)
     - If `NetControl.roster` is still empty AND `rosterLoadError` is false → inline error: `"Loading roster — try again in a moment."` Clear `inFlightCheckin`. (Rare in practice: snapshot fetch typically returns within the time the NCO is reading the Logging screen.)
     - Else, `findCandidatesBySuffix(raw)`:
       - **Zero candidates** → inline error: `"No callsign in the roster ends with '<suffix>'. Type the full callsign or check the suffix."` Clear `inFlightCheckin`.
       - **One or more candidates** → render the candidate list with up to 10 rows, first auto-focused. NCO can press Enter to commit the focused row, Tab to cycle, click any row, or Escape / Cancel to dismiss.
   - **Neither valid nor suffix-only** (e.g. `@#$`, `7ABCD`, `abc`) → existing generic format error.
6. On candidate tap (or Enter on focused candidate): `onCandidateTap(callsign)` calls `recordCheckin` with the full callsign, **reusing the eventId** stashed in `inFlightCheckin` by step 5's suffix-only branch. On success: candidate list hides, input clears, the row appears in the "Last 5" log just like a direct LOG. On BUSY retry: callWithRetry's existing backoff fires; eventId is identical so no double-log.
7. On Escape / Cancel: `dismissCandidates()` hides `#candidates-row`, restores `#log-input-row`, clears `NetControl.inFlightCheckin` (so the next LOG mints a fresh eventId), restores focus to `#f-callsign`. **The typed suffix remains in the input** so the NCO can add more characters.
8. End Net: existing flow. **"Session start" semantics: `NetControl.roster` and `NetControl.rosterLoadError` are re-initialized when `onStart` (the Start Session form submit) runs.** This is the only path that re-populates `NetControl` — `onNewNet` (the "Start new net" button on the summary screen) returns to the Start screen but doesn't pre-fill state; the next `onStart` does the re-init. The reset literal in `onNewNet` must include `roster: []` and `rosterLoadError: false` so the NetControl object shape stays consistent during the back-to-Start transition.

### Candidate list UI (pseudo-HTML)

```html
<section id="screen-log" class="active">
  <!-- existing Logging row -->
  <div id="log-input-row">
    <label for="f-callsign">Callsign</label>
    <input id="f-callsign" ... />
    <button id="btn-log">LOG</button>
    <div id="e-callsign" class="field-error" role="alert"></div>  <!-- existing role -->
  </div>

  <!-- NEW: candidate list, hidden by default. NOT a listbox — semantic <ul><button>. -->
  <div id="candidates-row" hidden>
    <p id="candidates-prompt" aria-live="polite">Suffix matches:</p>
    <ul id="candidates-list">
      <!-- dynamically populated, e.g.:
        <li><button class="candidate" data-callsign="W7ABC">
          W7ABC — Darby, Brian
          <span class="recent-badge">this net</span>
        </button></li>
      -->
    </ul>
    <button id="btn-candidates-cancel" type="button">Cancel — keep typing</button>
  </div>

  <!-- existing Last-5 log + counters -->
  ...
</section>
```

### ARIA strategy

- `#e-callsign` already carries `role="alert"` (Slice 1). The "no matches in roster" inline error reuses that channel; screen readers announce the text change automatically.
- `#candidates-prompt` carries `aria-live="polite"` so the count and "Suffix matches: N found." line is announced when the candidate list becomes visible. Screen-reader users get the count + the auto-focused first row's text, which together describe the new UI surface.
- `#candidates-list` is a semantic `<ul>` of `<li><button>` rows — **no** `role="listbox"`, **no** `role="option"`. Reason: listbox semantics imply roving tabindex with `aria-activedescendant`, which is more complex than this UI needs. Native focus on `<button>` is exactly what we want — keyboard users Tab through, screen readers announce each button's text on focus.
- First `<button>` auto-focused on render (`element.focus()`); the visible focus ring is the SR-equivalent of "first candidate selected".
- `.recent-badge` is a visual chip only — text content `"this net"` is part of the button's accessible name (no `aria-hidden`).

### CSS hooks

- `.candidate { display: block; min-height: 48px; ... }` — WCAG 2.1 AA tap-target minimum.
- `.candidate:focus { outline: ... }` — visible focus ring.
- `.recent-badge { font-size: 0.75em; padding: 0 0.4em; border-radius: 0.5em; background: ...; }` — small chip after the name (or after the callsign when name is empty).

---

## OAuth scopes

No changes to `appsscript.json`. The existing scopes (`https://www.googleapis.com/auth/spreadsheets`, `https://www.googleapis.com/auth/userinfo.email`) cover reading the Roster tab from the same Spreadsheet.

---

## State management

| Surface | Scope | What it holds | When written / read |
|---|---|---|---|
| Spreadsheet `Roster` tab | the configured Spreadsheet | rows of `Callsign, Name, LastActive` | Written: by hand in Slice 2; by Sunday-Sync trigger in Slice 3. Read: by `getRosterSnapshot` on every session start. |
| `NetControl.roster` (client memory) | per-tab, per-session | array of `RosterEntry` from the snapshot | Written: once after `startSession` ok. Read: on every keystroke in the Logging input that triggers the suffix-only branch. Cleared on End Net. |
| `NetControl.rosterLoadError` (client) | per-tab, per-session | boolean | Written: at snapshot fetch. Read: in the suffix-only branch. Cleared on End Net. |

**PropertiesService:** no new keys.
**CacheService:** none. Slice 2 fetches the snapshot fresh per session — adequate for ≤500 rows; revisit when Sunday-Sync or PWA lands.

---

## Concurrency

- `setupSheets` already wraps tab creation in `LockService.getScriptLock(...).tryLock(10000)`. Adding Roster to its tab list inherits that lock; no new lock pattern.
- `getRosterSnapshot` is read-only — no lock. **Project convention formalized in this slice: `withLock` is used for write paths only; pure-read entry points omit it.** Rationale: holding the script lock during reads serializes them unnecessarily and exhausts the lock for the write path's `tryLock(10000)` timeout. A concurrent Sunday-Sync (future slice) writing to `Roster` while this read is in flight is acceptable — Sheet reads are atomic at the cell level, so a partial mid-write read can't corrupt data; the worst case is missing a row added in the last few milliseconds, which is well within the snapshot's once-per-session freshness budget.
- The candidate-list UI on the client is per-tab — no shared client state.

---

## Apps Script execution budget

- `getRosterSnapshot`: one `Sheet.getDataRange().getValues()` call + an `Array.prototype.filter` + `Array.prototype.map`. For 500 rows this is ~50 ms in practice. Well under the 6-min limit and the PRD's ≤200ms client-side budget (server-to-client RTT is part of the network cost, not the function cost).
- `setupSheets`: unchanged ceiling — adding one more `getOrCreateSheetWithHeader` call is sub-second.
- Client-side `findCandidatesBySuffix`: linear scan of ≤500 entries with a string-endsWith test, ~1 ms in V8 — well within the PRD's ≤200ms perceived performance budget.

---

## HtmlService rendering

- No new template scriptlets (`<?= ?>` or `<?!= ?>`) are introduced. The candidate list is rendered via `document.createElement` + `textContent` (NOT `innerHTML`). Callsign and Name fields are user-controllable (anyone with edit access to the Roster tab can put any string in Name), so escaping matters.
- Inline event handlers: none introduced; the candidate-tap handler is attached via `addEventListener` on the parent list (event delegation).
- The auto-focus on first candidate uses `element.focus()` — no scriptlet involvement.

---

## Failure modes

| Failure | User-visible behavior |
|---|---|
| `getRosterSnapshot` returns `NOT_CONFIGURED` (Spreadsheet or Roster tab missing) | Session-start path continues normally. `NetControl.rosterLoadError = true`. Suffix-only LOG attempt shows `"Roster unavailable — type the full callsign (e.g. W7ABC)."` (the Slice 1.5 bug-fix message at `src/html/index.html:424` is replaced — see §UX flow step 5 for the new wording rationale). Full-callsign LOG path is unaffected. |
| `getRosterSnapshot` returns `READ_FAILED` (Sheet read threw — quota, transient API error) | Same client behavior as `NOT_CONFIGURED` (`rosterLoadError = true`, same inline error). The two errors are semantically identical for the client: "no usable roster". They are kept distinct on the server so cloud logs can attribute the cause. |
| Network error during snapshot fetch (callWithRetry exhausted) | `.catch` handler sets `rosterLoadError = true`. Same UX as above. |
| Roster tab is empty (header row only) | `{ok: true, roster: []}`. Client never errors. Suffix-only LOG attempt shows `"No callsign in the roster ends with '<suffix>'. Type the full callsign or check the suffix."` for every suffix attempt. |
| Roster tab contains malformed entries (lowercase, special chars, blank Callsign) | `getRosterSnapshot` filters them out per the read-path rules: blank Callsign → silent skip; failing-validator Callsign → `Logger.log` warning + skip. The client only sees clean rows. |
| Roster Name column contains a Sheet formula (e.g. `=HYPERLINK("evil.com","click me")`) | The Sheet's `getValues()` returns the **resolved** value of the formula, not the formula text. The client renders that resolved string via `textContent` — XSS-safe, but the displayed name may be unexpected. Trustee-only attack surface (the Name field is writable only by people with edit access to the Roster tab); not a security finding for Slice 2, just a behavior note. |
| Two roster entries share the same callsign | `getRosterSnapshot` **dedups: last-write-wins on row order** (later row overwrites earlier). Slice 3 (Sunday-Sync) can build on this guarantee. |
| Roster tab exists with WRONG headers (e.g. legacy ActivARES `Callsign, Name, Class`) | `getOrCreateSheetWithHeader` does NOT rewrite headers on a pre-existing tab. `getRosterSnapshot` reads column C as `LastActive` and stores a license-class string there. Slice 2's UI doesn't display `LastActive`, so this is latent; Sunday-Sync (Slice 3) will own header-drift validation. **Acknowledged as a known limitation, not fixed here.** |
| NCO starts typing before the snapshot returns | Snapshot is **not** consulted on keystroke — only on LOG/Enter. On LOG, if `roster` is empty AND `rosterLoadError` is false, suffix-only branch shows `"Loading roster — try again in a moment."` and clears `inFlightCheckin`. Rare in practice (snapshot fetch typically returns within a few hundred ms; NCO is reading the screen). **Late-resolution UX cue:** when the snapshot's `.then` populates `NetControl.roster`, IF `#e-callsign.textContent` is the "Loading roster" string at that moment, also clear `#e-callsign` so the user sees the field is ready. This is a one-line addition in the `.then` handler. |
| NCO presses LOG with a typed full callsign while candidate list is showing | `#btn-log.disabled = true` is set by `renderCandidates` and cleared by `dismissCandidates` / `onCandidateTap` success. The Enter-key handler on `#f-callsign` (existing wiring at `src/html/index.html:526-528`) MUST also be gated: the handler checks `if ($('candidates-row').hidden === false) return;` before calling `onLog`. Without that gate, focus returning to `#f-callsign` while the list is visible would let Enter bypass the disabled LOG button. |
| Quota exhaustion on `Sheet.getDataRange()` | Apps Script throws; `getRosterSnapshot`'s try/catch returns `{ok: false, error: 'READ_FAILED'}` and `Logger.log`s the exception. Client treats as "no usable roster" (see READ_FAILED row above). |

---

## Verification criteria

### Jest unit tests (`tests/main.test.ts` additions)

Tests under a new `describe('getRosterSnapshot', ...)`:

1. `'returns NOT_CONFIGURED when SpreadsheetId is unset'`
2. `'returns NOT_CONFIGURED when the Roster tab is missing'`
3. `'returns READ_FAILED when getDataRange().getValues() throws'` (mock the Sheet to throw; assert the discriminant is `'READ_FAILED'`)
4. `'returns an empty roster array when the Roster tab has only the header row'`
5. `'returns one RosterEntry per data row with Callsign, Name, LastActive fields populated'`
6. `'skips data rows with empty Callsign'` (asserts the row is absent from the result; does NOT assert log output)
7. `'skips data rows with malformed Callsign'` — `it.each([['lowercase', 'k7abc'], ['special chars', 'K7!BC'], ['suffix-only', 'ABC']])` — same assertion shape as #6 (row absent from result; no log-output assertion).
8. `'dedups duplicate callsigns: later row wins'`
9. `'preserves declaration order of valid, non-duplicate rows'`

Tests under `describe('setupSheets', ...)` updates:

10. `'creates Sessions, Checkins, AND Roster tabs on first run'` (replaces existing first-run test; `created` array equals `['Sessions', 'Checkins', 'Roster']`)
11. `'is idempotent: re-running returns created: [] when all three tabs exist'` (replaces existing idempotency test)

**Not unit-tested in Slice 2:** `findCandidatesBySuffix` (the client-side priority and name-lookup logic). Slice 1's design accepted "no jsdom setup, no client-side jest tests" as Slice 1 tech debt; Slice 2 inherits that posture. Coverage for this function is via Chrome MCP walkthrough only. **Specifically deferred invariants that the walkthrough does NOT exercise:** (a) the "first 10" truncation when more than 10 candidates match (the smoke-test seed has at most 3 matches per suffix), and (b) the band-1 ∩ band-2 deduplication invariant (a callsign present in both `checkins` and `roster` appears exactly once, in band 1, with the chip). Both will be Jest-tested when the jsdom + module-extraction out-of-scope follow-up lands. **Out-of-scope follow-up (added to the deferrals list):** stand up a jsdom config + extract client-side suffix logic into an importable module so jest can cover the priority order, the 10-cap truncation, and the band-dedup invariant.

### Chrome MCP walkthrough (post-`clasp push`)

Pre-condition: Brian manually populates the Roster tab with at least these 6 rows for the smoke test (KE7ABC is included so the suffix `ABC` produces three candidates — exercises the multi-match path). **The seed is ephemeral** — recreated by hand each smoke pass; not checked into the repo. The repo does contain `members-20260513-163043.csv` at the root from a prior export, but the smoke-test seed below is a small curated subset rather than the full member list:

| Callsign | Name | LastActive |
|---|---|---|
| W7ABC | (blank) | (blank) |
| KE7ABC | (blank) | (blank) |
| KE7XYZ | Darby, Brian | (blank) |
| K7TST | (blank) | (blank) |
| N7DEF | (blank) | (blank) |
| KH6/W7ABC | (blank) | (blank) |

(K7TEST in earlier revisions was changed to K7TST during implementation — the post-bug-fix `isValidCallsign` regex requires 1-3 letters after the digit, so `K7TEST` (4-letter suffix `TEST`) would have been silently filtered by `getRosterSnapshot`'s validation.)

Walkthrough at the `/dev` URL:

1. **Golden path — multiple matches.** Start a session. Type `ABC` → click LOG → candidate list appears with **THREE** candidates (W7ABC, KE7ABC, KH6/W7ABC — all `endsWith("ABC")`). Click W7ABC → row lands in Checkins with Callsign `W7ABC`. Confirm.
2. **Name rendering.** Type `XYZ` → click LOG → candidate list with one row: `KE7XYZ — Darby, Brian`. Confirm the Name renders as `"Darby, Brian"` (no escaping artifacts on the comma).
3. **No-match.** Type `QQQ` → click LOG → `#e-callsign` inline error: `"No callsign in the roster ends with 'QQQ'. Type the full callsign or check the suffix."` No candidate list shown.
4. **Recent-this-net priority badge + name lookup.** First log **KE7XYZ** (full callsign — direct LOG path, no candidate list) so the band-1 lookup has a roster row with a populated Name to render. Clear input, type `XYZ` → click LOG → candidate list shows ONE candidate: `"KE7XYZ — Darby, Brian"` with the `<span class="recent-badge">this net</span>` chip. Verifies (a) recent-this-net priority places this in band 1, (b) the band-1 name lookup against `NetControl.roster` correctly renders the name, and (c) the chip is positioned after the name.
5. **Dismiss via Escape.** Type `ABC` → click LOG → candidate list appears → press **Escape** → candidate list closes, `ABC` still in the input, focus is back on `#f-callsign`. Add `D` to make `ABCD` → click LOG → existing generic format error (matches neither full-callsign nor suffix-only regex).
6. **Dismiss via Cancel button.** Type `ABC` → click LOG → candidate list appears → click **Cancel — keep typing** → candidate list closes, `ABC` still in the input, focus is back on `#f-callsign`. (Same end state as step 5, different trigger.)
7. **Slash-prefix endsWith match.** Type `ABC` → click LOG → confirm `KH6/W7ABC` is among the candidates (per the design decision that `"KH6/W7ABC".endsWith("ABC")` is true).
8. **Roster unavailable.** Temporarily rename the Roster tab to `Roster_x` in the Sheet; reload the `/dev` URL; start a session; type `ABC` → click LOG → `#e-callsign` inline error: `"Roster unavailable — type the full callsign (e.g. W7ABC)."` Rename back to `Roster` when done.
9. **Direct full-callsign LOG (no regression).** Type `W7ABC` → click LOG → standard LOG path; row lands. The LOG path does NOT consult the roster (the full-callsign branch fires before any roster check).
10. **eventId continuity on candidate retry.** Set `LockService` to busy via a separate browser tab (or use a contrived test by closing the Roster tab mid-flight). Type `ABC` → click LOG → candidate list appears → click W7ABC → expect `BUSY_TRY_AGAIN`-driven retry to commit exactly one row (not two). Verifies the eventId is reused from the suffix-only branch to the candidate-tap.

### OAuth-scope re-verification

No new scope. After `clasp push`, confirm **Project Settings → OAuth scopes** in the Apps Script editor still lists ONLY `spreadsheets` and `userinfo.email` — nothing else.

---

## Out-of-scope follow-ups

(Added to the master design-doc list in `plans/designs/slice-1-...md` AND tracked here for Slice 2.)

- **Sunday-Sync time trigger + Drive CSV → Roster pipeline.** Slice 3. Includes `drive.readonly` (or `drive.file`) scope addition, validation of the CSV's schema, trustee email on validation failure, and the `LastActive` column population. **Roster-tab header validation** lives in this slice — Slice 2 explicitly does NOT detect a Roster tab that was created with the wrong headers. **CSV-injection sanitization** also lives in this slice — when Sunday-Sync writes a Name from CSV, leading `=`, `+`, `-`, `@` characters MUST be prefixed with a single quote (the Google Sheets / Excel CSV-injection defense) so the resolved value the Slice 2 read-path sees is the literal string, not a formula. Slice 2's `textContent` rendering is XSS-safe regardless, but a re-export back to CSV (e.g. for ARRL Form 2 in a later slice) would re-introduce the risk if not sanitized at the write point.
- **Suffix-Tap thumb-zone numeric keypad UI.** Separate sub-slice — the keypad is a substantial UX surface that benefits from its own design pass. Slice 2's text-input candidate-list is the load-bearing data-flow piece; the keypad layer is purely visual on top.
- **IndexedDB cache for the roster snapshot.** Slice with PWA / offline support. Includes `RosterVersion` cache-invalidation header on the snapshot.
- **Async FCC/HamDB resolver** for callsigns typed in full but not in roster. Future slice. Returns the full WashCoARES name from a public source when an NCO logs a visitor not on the roster.
- **`UnknownCallsigns-this-net` tab** for the resolved-fallback / unknown-fallback priority bands (PRD FR-3 priority order steps 3 and 4).
- **Candidate-list virtualization** if the no-match path's "did you mean" suggestions become long enough to need it.
- **Performance instrumentation** (≤200 ms perceived for ≤500 entries — PRD §155). Out of scope until we have a baseline; first measurement should happen when IndexedDB is the backing store.
- **Roster admin UI** so the trustee can add/edit callsigns without touching the Sheet directly. Optional — the Sheet is a perfectly serviceable admin UI.
- **jsdom client-side jest config** + extract suffix logic (`findCandidatesBySuffix`, `renderCandidates`) into an importable module so the priority order can be unit-tested. Slice 2 ships with Chrome-MCP-only coverage for these.
- **Suffix length widening 1-3 → 1-5** to match PRD FR-3 literal. Slice 2 sticks with 1-3 (matches the existing `SUFFIX_ONLY_RE` from the Slice 1.5 bug fix); revisit if telemetry shows NCOs frequently typing 4+ characters of suffix.
- **Slash-prefix special handling** if the `endsWith("ABC")` rule on `KH6/W7ABC` proves surprising in practice. The alternative is "split on slash, match the base callsign suffix" — strictly more code; defer until there's a UX issue to solve.

---

## Implementation plan (preview)

For Step 3 of the `/eg-new-feature` skill once design-check passes:

1. `src/server/types.ts` — add Roster constants (`SHEET_ROSTER`, `ROSTER_HEADERS`, `RosterCol`), `RosterEntry` interface, `GetRosterSnapshotResult` union with `NOT_CONFIGURED` + `READ_FAILED` variants. Widen `SetupSheetsResult.created` literal union to include `'Roster'`.
2. `src/server/main.ts` — extend `setupSheets` to create Roster tab; add `getRosterSnapshot` with the read-path rules from §Interfaces.
3. `scripts/build.mjs` — append `getRosterSnapshot` to the explicit-shim list (after the `setupSheets` line; preserve declaration order).
4. `tests/main.test.ts` — add `getRosterSnapshot` describe block (11 cases); update setupSheets first-run and idempotency tests.
5. `src/html/index.html` — client state additions (`roster: []`, `rosterLoadError: false`) including the `onNewNet` reset literal; candidate-list section in `#screen-log`; `onLog` branch with eventId continuity; `onCandidateTap`, `renderCandidates`, `findCandidatesBySuffix`, `dismissCandidates`; CSS for `.candidate` and `.recent-badge`.
6. `npm run build && npx clasp push` (NO `--force` — manifest is unchanged, so the prompt-on-changes path doesn't fire; `--force` is only needed when manifest or scope changes). Chrome MCP walkthrough per §Verification criteria.

---

## Round 2 changes (response to goldfish round 2)

Round 2 critic surfaced 15 gaps; round-2 readiness passed at `implementation ready` with zero open questions. Round 3 closes the 15 critic items as follows.

| Round 2 finding | Resolution |
|---|---|
| R2-C1 — Enter handler on `#f-callsign` not gated | **F** — Failure-modes row for the LOG-disable case now spells out the Enter-handler gate explicitly: `if ($('candidates-row').hidden === false) return;` at the top of the Enter wiring. |
| R2-C2 — LOG-disable wiring location ambiguous | **F** — `renderCandidates` step 4 sets `disabled = true`; `dismissCandidates` step 2 clears it; `onCandidateTap` success clears it. All three sites are now explicit in §Client functions. |
| R2-C3 — Band-1 source-of-iteration ambiguous | **F** — `findCandidatesBySuffix` body comment now says explicitly: iterate `NetControl.history` (newest-first), filter to those still in `NetControl.checkins`, then `endsWith`-filter. Disambiguates the two-implementer divergence. |
| R2-C4 — Escape keydown attached to non-focusable div | **F** — `dismissCandidates` now specifies: Escape listener is attached to `document` (not `#candidates-row`), with a `!$('candidates-row').hidden` guard so it's a no-op when the list isn't up. Robust across focus loss. |
| R2-C5 — "Identical to bug-fix message" claim is incorrect | **F** — Both occurrences updated. §UX flow step 5 and §Failure modes table now explicitly note that this REPLACES the Slice 1.5 bug-fix string at `src/html/index.html:424` rather than matching it. |
| R2-C6 — PRD FR-2 signature divergence not called out | **F** — Header section now has an explicit "PRD FR-2 signature divergence" paragraph: PRD specifies `(asOfTimestamp)` + `RosterVersion`; Slice 2's signature is narrower because the cache + RosterFallback are deferred. Widening planned when IndexedDB lands. |
| R2-C7 — No live-region for candidate-list count | **F** — `#candidates-prompt` now carries `aria-live="polite"`; pseudo-HTML and ARIA strategy both updated. `renderCandidates` populates the prompt with `"Suffix matches: N found."` so the count is announced. |
| R2-C8 — >10 truncation and band dedup invariant unverified | **F** — §Verification "Not unit-tested in Slice 2" block now names these two invariants explicitly as deferred-until-jsdom. Out-of-scope follow-ups entry updated. |
| R2-C9 — Walkthrough step 4 doesn't verify band-1 name lookup | **F** — Step 4 rewritten: log KE7XYZ first (which has Name `"Darby, Brian"`), then type `XYZ` — band-1 rendering now exercises (a) priority, (b) name lookup, (c) chip placement. |
| R2-C10 — Test #7 lumps three malformed shapes | **F** — Test #7 is now an `it.each` over `[['lowercase', 'k7abc'], ['special chars', 'K7!BC'], ['suffix-only', 'ABC']]`. |
| R2-C11 — Manual smoke-test seed not checked in | **F** — Pre-condition section now states explicitly that the seed is ephemeral (recreated each smoke pass). Notes the prior `members-20260513-163043.csv` export at the repo root for reference but does not depend on it. |
| R2-C12 — Scraping concern undocumented | **F** — §Server function "No admin gate" paragraph now includes the scraping trade-off rationale (acceptable for v0; obscure URL not public endpoint; revisit if WashCoARES wants the membership list private). |
| R2-C13 — CSV-injection risk in Sunday-Sync future slice | **F** — Out-of-scope follow-ups entry for Sunday-Sync now includes the CSV-injection sanitization requirement (leading `=`/`+`/`-`/`@` prefixed with single quote when writing). |
| R2-C14 — No per-row try/catch in snapshot loop | **F** — §Server function read path step 4 now wraps the per-row body in an inner try/catch so one bad row doesn't fail the whole snapshot. |
| R2-C15 — No "snapshot resolved late" UX cue | **F** — §Failure modes "NCO starts typing before the snapshot returns" row now adds a late-resolution cue: `.then` handler clears `#e-callsign` if it currently shows the "Loading roster" string. |

---

## Round 1 changes (response to goldfish round 1)

Round 1 critic surfaced 17 gaps; readiness surfaced 27 open questions. Round 2 closes them as follows. Items addressed in a doc revision are marked **F**; items intentionally rebutted with rationale are marked **R**.

| Round 1 finding | Resolution |
|---|---|
| C1 / R3 — `SetupSheetsResult.created` literal union must include `'Roster'` | **F** — §Surfaces touched (types.ts row) and §Interfaces (types.ts block) now call out the widening explicitly. Tests #10 and #11 updated. |
| C2 / R4 — Quota failure conflates with `NOT_CONFIGURED` | **F** — Added explicit `'READ_FAILED'` variant on the discriminated union and explicit `try/catch` in §Server function read path. Failure-modes table distinguishes the two server-side variants while noting client treats them identically. |
| C3 — No admin gate, undocumented | **F** — §Server function now has an explicit one-line rationale citing PRD §161 (callsigns + names are FCC-public). |
| C4 / R1 / R17 — Snapshot race; `rosterLoadError` trigger conditions | **F** — §UX flow step 3 now specifies the `.catch` handler explicitly, and step 5 names the rendering location (`#e-callsign`). `rosterLoadError` is set true on any of: `NOT_CONFIGURED`, `READ_FAILED`, network-exhaustion rejection. Full-callsign LOG explicitly never waits on the snapshot. |
| C5 / R7 — recent-this-net rows have no name | **F** — §Client functions `findCandidatesBySuffix` now specifies: look up name from `NetControl.roster` by callsign; if not found, render callsign-only. |
| C6 / R25 — Duplicate-callsign Roster collisions | **F** — §Server function read path step 5 specifies last-write-wins on row order; test #8 verifies. Removed the misleading "Slice 2 doesn't dedup" line from failure modes. |
| C7 — Header validation on Roster tab | **R** — Header drift is owned by Slice 3 (Sunday-Sync). Slice 2 explicitly acknowledges this in §Failure modes (the "Roster tab exists with WRONG headers" row) and in §Out-of-scope follow-ups. |
| C8 / R8 — `(this net)` marker design TBD | **F** — Picked: `<span class="recent-badge">this net</span>` chip after callsign+name. ARIA strategy section documents it; Chrome MCP walkthrough step 4 now asserts it. |
| C9 — No unit test for `findCandidatesBySuffix` | **R** — Slice 2 inherits Slice 1's "no jsdom setup" posture; this is tracked as accepted tech debt and the out-of-scope-follow-ups list now contains an explicit "stand up jsdom + extract suffix logic into importable module" entry. |
| C10 — OAuth-scope verification is performative | **F** — Tightened §Verification criteria's OAuth check to "Project Settings → OAuth scopes lists only spreadsheets + userinfo.email." |
| C11 / R5 / R6 — Live vs submit triggering of candidate list | **F** — §UX flow step 5 now states explicitly: candidate list renders on LOG button / Enter only, never on keystroke. No debounce, no live-suggest. Race-handling becomes a single-shot check rather than per-keystroke. |
| C12 / R22 — Suffix length 1-3 vs PRD's 1-5 | **F (1-3 retained)** — Documented in §Out-of-scope follow-ups as "Suffix length widening 1-3 → 1-5". Slice 2 matches the existing `SUFFIX_ONLY_RE` from the Slice 1.5 bug fix; widening is a future-PRD update. |
| C13 — Formula-injection acknowledgment | **F** — §Failure modes row "Roster Name column contains a Sheet formula" added. Notes the trustee-only attack surface and that `textContent` rendering is XSS-safe even on resolved formula values. |
| C14 — `--force` flag cargo-cult | **F** — §Implementation plan step 6 drops `--force` and documents when it IS needed (manifest / scope changes only). |
| C15 — `onNewNet` reset must include new fields | **F** — §Surfaces touched index.html row (b) explicitly says the new fields MUST be added to the reset literal in `onNewNet`. |
| C16 / R9 — ARIA model | **F** — Dropped `role="listbox"` and `role="option"` (incorrect for this pattern). New §ARIA strategy section specifies: semantic `<ul><li><button>` with native focus on first button; `#e-callsign`'s existing `role="alert"` handles no-match announcements. |
| C17 / R11 — `screen-candidates` element doesn't exist | **F** — All references corrected to `#candidates-row` (matches the pseudo-HTML). The disable rule keys off `#candidates-row.hidden`, documented in failure modes. |
| R2 — `LockService` for read-only | **F** — §Concurrency now formalizes the project convention: `withLock` for writes only; reads omit. Rationale documented (avoids serializing reads and exhausting the lock for the write path). |
| R5 — "up to 10" cut order | **F** — §Client functions specifies: first 10 in priority order, band 1 by `NetControl.history` order (newest-first), band 2 by declaration order. |
| R10 — `eventId` continuity onLog → onCandidateTap | **F** — §UX flow steps 5 and 6 now specify: onLog's suffix-only branch mints `eventId` and stashes in `inFlightCheckin.eventId` (callsign null until pick); `onCandidateTap` reuses it. Chrome MCP walkthrough step 10 verifies via BUSY-retry. |
| R12 — `dismissCandidates` listener attachment | **F** — §Client functions specifies: Escape `keydown` attached to `#candidates-row` on render, removed on dismiss. Cancel button has its own click handler. |
| R13 — Name blank rendering | **F** — §Client functions specifies: when Name is empty string, render `"W7ABC"` only — no trailing dash or space. |
| R14 — `callWithRetry` for snapshot | **F** — §UX flow step 3 specifies `callWithRetry` (same semantics as `startSession`). |
| R15 — "session start" semantics | **F** — §UX flow step 8 specifies: "session start" = `onStart` submit; `onNewNet` returns to the Start screen but doesn't pre-fill state. |
| R16 — Cancel button focus | **F** — §Client functions `dismissCandidates` specifies: restore focus to `#f-callsign` on both Escape and Cancel paths. |
| R18 — Empty Callsign row counting | **F** — §Server function read path step 4 splits the cases: empty after trim → silent skip (no warning, no count); non-empty failing validator → Logger.log warning + skip. |
| R19 — Test #6 logs assertion | **F** — Test #6 wording clarified: asserts row absent from result; does NOT assert log output. |
| R20 — `RosterCol` usage | **F** — §Server function explicitly says `RosterCol` IS used in the read path; the constant is not declared-but-unused. |
| R21 — Case-insensitive belt-and-suspenders | **R** — Kept. §Client functions inline comment documents the rationale (harmless and future-proof against either side regressing to mixed case). |
| R22 — `KH6/W7ABC` matches suffix `ABC` | **F** — Explicit decision: yes, `endsWith` rule applies; slash-prefixed roster entries match. Chrome MCP walkthrough step 7 verifies. Special-casing tracked as an out-of-scope follow-up. |
| R23 — `LastActive` shape validation | **F** — §Interfaces `RosterEntry` field comment specifies: Slice 2 trusts whatever is in cell C; no validation; Sunday-Sync writes well-formed values. |
| R24 — Shim placement in build.mjs | **F** — §Implementation plan step 3 specifies: append after the `setupSheets` line; preserve declaration order. |
| R26 — `appsscript.json` location | **F** — §Surfaces touched row now reads "appsscript.json (repo root)". |
| R27 — Smoke test multi-match seed inadequate | **F** — §Chrome MCP walkthrough seed table expanded to 6 rows including `KE7ABC` so suffix `ABC` produces 3 candidates (W7ABC, KE7ABC, KH6/W7ABC). Walkthrough step 1 retitled to "multiple matches".|
