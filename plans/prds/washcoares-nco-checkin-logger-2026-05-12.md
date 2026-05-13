# PRD: WashCoARES NCO Callsign-Only Check-in Logger

**Date:** 2026-05-12
**Author:** elephant (Claude Code) with Brian Darby (briandarby@pm.me)
**Source:** `/eg-prd` — synthesized from [`plans/eg-brainstorms/nco-callsign-only-2026-05-11.md`](../eg-brainstorms/nco-callsign-only-2026-05-11.md) + 25 user-answered gap-fills on 2026-05-12
**Stage:** Standard PRD, ready for `/eg-new-feature`
**Depth:** Standard (3-5 pages)

---

## Executive summary

A Google Workspace web app for WashCoARES Net Control Operators (NCOs) that turns a check-in into three thumb taps: type the last 2-3 characters of a callsign, pick from the candidate list, LOG. Names auto-resolve from a weekly Sunday-Sync of the ActivARES roster (delivered as a CSV in a shared Drive folder) with an async FCC-lookup fallback for unknowns. At End-Net, the app emails a summary to the Emergency Coordinator and rolls each participant into a monthly totals tab at 0.5 hours per check-in. The NCO never types a name, never enters a clock value, and never blocks on the network — the app is a PWA backed by IndexedDB and writes through to the Workspace Sheet when connectivity allows.

---

## Problem statement

WashCoARES NCOs rotate weekly through a role that holds a microphone in one hand and is expected to capture every participant station on the air — typically 15-30 stations per weekly practice net, more during a real activation. There is currently no log artifact at all; participant-hours and net-count rollups that the Emergency Coordinator (EC) sends monthly up the chain-of-command are reconstructed from memory or absent. Existing amateur-radio logging tools assume a two-handed desktop operator on a quiet shack — they fail the one-handed constraint, they fail the rotating-volunteer-with-no-training-time constraint, and they fail the offline-during-real-activation constraint. The NCO needs a logger so trivial that "easiest logging app ever created" is the only acceptable bar.

---

## Target users

**Primary:** WashCoARES Net Control Operators on rotation. Mixed-experience volunteers — some weekly regulars, some twice-a-year. Holding a hand-mic with PTT in their dominant hand. Either at home/mobile (most practice nets) or at a served-agency facility (real activations).

**Secondary:** WashCoARES Emergency Coordinator. Consumes a monthly auto-email with member-hours and event-counts to forward up the chain.

**Tertiary:** WashCoARES Trustee. Maintains the ActivARES → Drive CSV pipeline (already exists or will be built outside this PRD); reviews `UnknownCallsigns` and Sheet rows when needed; eventually toggles the access-mode switch from "anyone with link" to "domain-restricted."

**Job-to-be-done:** "When I'm running a directed net and stations are checking in faster than I can write, I want to capture every callsign without taking my eye off the air or my hand off the mic, so I produce a record the EC can roll into the monthly report without rebuilding it from memory."

**Trigger / moment of need:** The first carrier drops in response to "this is the WashCoARES net, please call now with check-ins." From that moment for the next 5-15 minutes the NCO is under load.

---

## Current state

The repo is greenfield. No source code, no Apps Script project, no Drive artifacts beyond two prior brainstorm documents (`plans/eg-brainstorms/`). The project conventions live in `CLAUDE.md`: TypeScript + HtmlService + Apps Script deployed via `clasp`, jest with Apps Script-global doubles, the constraint list (6-minute execution limit, HtmlService XSS rules, OAuth scope minimization, LockService for shared writes, PropertiesService scoping, `Session.getActiveUser()` vs `getEffectiveUser()`, trigger dedup).

Two upstream / adjacent systems exist or are assumed:

- **ActivARES** — a WashCoARES-internal Apps Script app. For this PRD's purposes, the only contract that matters is: ActivARES drops a roster CSV into a shared Drive folder on a known cadence (target: weekly, Saturday-night-ish, in time for Sunday practice nets). Building that drop is out-of-scope for this PRD; the contract is.
- **FCC ULS / HamDB.org** — public callsign databases used as fallback when a callsign hits the app but isn't in the most-recent Sunday-Sync roster (e.g. a ham who licensed Tuesday checking in Thursday). Used by an async resolver, never on the synchronous check-in path.

Nothing existing to reuse, refactor, or migrate.

---

## Proposed solution

A single Apps Script web app (`NetControl`) deployed in the WashCoARES Workspace, plus three time-driven triggers and one HtmlService PWA front-end.

**Front-end (NCO-facing PWA):**
- Three screens: **Start Net** (session form), **Logging** (Suffix-Tap keypad + live log), **End Net** (summary + email-to-EC confirmation).
- The Logging screen is the load-bearing UX. A thumb-zone keypad accepts 2-3 character callsign suffixes, runs a local IndexedDB lookup against (recent-this-net ∪ Sunday-Sync roster ∪ resolved-fallback ∪ unknown-already-this-net), and on a single match LOGs on tap. On multiple matches it surfaces a vertical candidate list with large tap targets; one more tap commits.
- Local-first: every check-in writes to IndexedDB first and to a per-session in-memory log visible to the NCO. A background flush pushes to the Workspace Sheet via `google.script.run`; offline writes queue until reconnection. The NCO never waits on the network.
- Last 5 log entries always visible. Each row tappable for inline edit/delete. Undo button on the most recent entry for ~10 seconds.

**Back-end (Apps Script server):**
- Web app deployed with `executeAs: USER_ACCESSING`, `access: ANYONE` at v0 (configurable via the `Config` tab to `DOMAIN` once the trustee is ready to tighten).
- Server functions: `startSession`, `endSession`, `recordCheckin`, `editCheckin`, `undoLastCheckin`, `backfillCount`, `resolveCallsignLocal`, `getRosterSnapshot`.
- All write paths wrapped in `LockService.getScriptLock().tryLock(...)`. First-write-wins per `(SessionID, Callsign)` with a conflict toast surfaced to the second NCO.

**Triggers:**
- `sundaySync` — time-driven, weekly (Saturday late, configurable). Reads the most recent CSV in the configured Drive folder, validates schema, writes to the `Roster` tab. Emails the trustee on failure.
- `asyncResolveUnknowns` — time-driven, hourly. Processes `UnknownCallsigns` rows where `ResolutionStatus = 'pending'`. Calls FCC ULS / HamDB.org with checkpoint pattern (resume on next run if approaching the 6-minute limit). Writes resolved names back into the `Checkins` rows and into the `RosterFallback` tab for future cache hits.
- `monthlyReportEmail` — time-driven, 1st of each month at 06:00 local. Computes prior-month totals from the `Checkins` tab (count × 0.5 hours per callsign per month), writes to `MonthlyTotals` tab, emails the EC.

---

## Scope

**In:**
- Single-NCO directed-net logging with Suffix-Tap input.
- Sunday-Sync roster cache from a Drive CSV.
- Async FCC/HamDB resolution for unknowns; result is **not** promoted back to the ActivARES roster.
- Per-net session metadata: date, time, net type, NCO callsign, repeater/frequency, free-text purpose/notes.
- Multiple check-in events allowed per callsign per net; first event wins for hours math.
- Fixed 0.5 hour credit per (callsign, session) for hours roll-up.
- Auto-email summary to EC at End Net.
- Monthly auto-email rollup to EC on the 1st.
- Single-level undo + edit-on-tap during a session.
- Sequential multi-NCO handoff (NCO A ends session or transfers, NCO B opens it on their device — same SessionID, the second NCO becomes the recorded author of subsequent rows).
- Online backfill of past nets by check-in count only (no callsigns) — app multiplies count × 0.5 hours.
- Offline operation as a PWA with IndexedDB; sync to Sheet on reconnect.
- WCAG 2.1 AA with 48px minimum tap targets.
- 5-year rolling auto-purge of `Checkins` and `Sessions` rows (admin-overridable).

**Out:**
- True concurrent multi-NCO logging on the same session at the same time (only sequential handoff is supported).
- Per-participant variable hours (per-checkin actual-duration math). All credit is the flat 0.5-hour-per-checkin rule.
- Traffic-log entries (ICS-309 / origin → destination → precedence). Future PRD.
- Voice / STT input. Future PRD.
- ARRL Form 2 integration. Future PRD.
- Promotion of resolved callsigns back into the upstream ActivARES roster.
- Cross-app data sharing — the side-store (resolved + unknown rows) is scoped to this app only.

---

## User stories / Jobs-to-be-done

1. **As an NCO, when a station says "W7XYZ checking in,"** I want to type `XYZ` on a thumb keypad and tap LOG, so the row is captured before the next station keys up.
2. **As an NCO, when "XYZ" matches two callsigns** (W7XYZ and K7XYZ), I want a vertical list of both candidates with names visible, so I can tap the right one without typing more.
3. **As an NCO, when a station's callsign isn't in the roster,** I want to log it anyway by callsign alone, so the row is preserved and the name resolves later asynchronously — without me typing a name.
4. **As an NCO, when I mis-tap a row,** I want a single-tap Undo on the most recent entry and a tap-to-edit on any visible row, so corrections never break my flow.
5. **As an NCO, when the network drops mid-net,** I want check-ins to keep logging to my local device, so the net continues and rows flush when connectivity returns.
6. **As an NCO running on agency hardware,** I want the same app to work on a desktop browser or my phone, so the deployment context doesn't change how I work.
7. **As the EC, on the 1st of each month,** I want a roll-up email with each member's check-ins and hours for the prior month, so I can pass the report upstream without compiling it manually.
8. **As the EC or trustee, after a net the app couldn't run,** I want to backfill the check-in count for that date, so the hours total stays accurate even without per-callsign rows.
9. **As the trustee, when the time is right,** I want to tighten access from "anyone with link" to "domain-restricted" with a single config change, so we don't lose the v0 audience while we wait to harden auth.

---

## Functional requirements

Each is testable in isolation.

**FR-1 (Start Session).** Server function `startSession({date, time, netType, ncoCallsign, repeater, purposeNotes})` writes a row to `Sessions` with `Status = 'Open'`, returns the `SessionID`. Required: `date`, `netType`, `ncoCallsign`. Others optional.

**FR-2 (Roster snapshot).** On session start, server function `getRosterSnapshot(asOfTimestamp)` returns the contents of `Roster` + `RosterFallback` for the client to load into IndexedDB. Snapshot has a single `RosterVersion` for cache invalidation.

**FR-3 (Suffix-Tap resolution, client-side).** Given a 1-5 character suffix, client returns matching callsigns from the local snapshot in priority order: `recent-this-net` → `Roster` → `RosterFallback` → `UnknownCallsigns-this-net`. Resolution is offline-capable and synchronous (≤200ms perceived).

**FR-4 (Record check-in).** Server function `recordCheckin(sessionId, callsign, clientTimestamp)` writes a row to `Checkins`. If the callsign already has a row this session, the existing row is retained (first-event wins for hours) and a new event-tap counter on the existing row increments. NCO email is captured via `Session.getActiveUser().getEmail()`.

**FR-5 (Unknown callsign).** If a recorded callsign matches nothing in roster or fallback, also write to `UnknownCallsigns` with `ResolutionStatus = 'pending'`.

**FR-6 (Async resolver).** `asyncResolveUnknowns` trigger processes `pending` rows hourly: lookup FCC ULS → HamDB.org → mark `resolved` or `not_found`. Writes resolved name back into the originating `Checkins` row(s) AND into `RosterFallback`. Checkpoint progress in `PropertiesService.getScriptProperties()` to survive 6-minute boundaries.

**FR-7 (Undo).** Server function `undoLastCheckin(sessionId, checkinId)` deletes the named row, including the `UnknownCallsigns` side-row if applicable. Client UI exposes this only for the most recent entry within ~10 seconds of LOG.

**FR-8 (Edit-on-tap).** Server function `editCheckin(checkinId, {callsign? | delete: true})` modifies or deletes any row in the active session. Client exposes this on tap-and-hold of any visible row.

**FR-9 (End Session).** Server function `endSession(sessionId)` sets `Sessions.Status = 'Closed'`, writes `Sessions.EndTime`, computes the session's check-in count and hours total, formats a summary, and calls `MailApp.sendEmail` to the configured EC address. On `MailApp` quota exhaustion the email is queued (single retry next day) and the End-Net screen surfaces a "summary pending" notice.

**FR-10 (Backfill count-only).** Server function `backfillCount(date, time, netType, ncoCallsign, repeater, purposeNotes, checkinCount)` creates a session row with `Status = 'Backfilled'` and writes `checkinCount` placeholder check-in rows tagged `Source = 'PaperBackfill'`. These contribute to monthly hours math but have no callsign / name.

**FR-11 (Sunday-Sync).** `sundaySync` trigger lists files in the configured Drive folder, picks the newest CSV, validates schema `Callsign,Name,LicenseClass`, replaces the `Roster` tab contents in a single batched write inside `LockService.getScriptLock()`. On schema-mismatch or empty file, emails the trustee and leaves the prior roster intact.

**FR-12 (Monthly report).** `monthlyReportEmail` trigger on the 1st: for each unique callsign in the prior month's `Checkins`, count check-in rows (one row per unique-session-per-callsign — re-checkins do not double-count), multiply by 0.5, write to `MonthlyTotals`, email a tabular summary to the EC.

**FR-13 (5-year purge).** Annual trigger purges `Checkins` and `Sessions` rows older than 5 years. `MonthlyTotals` is retained.

**FR-14 (Access mode toggle).** A single `Config` tab cell named `AccessMode` accepts `anyone` (default at v0) or `domain`. On change, the trustee redeploys the web app with the matching `access:` setting. (Note: Apps Script web-app `access:` is a deployment-time setting, not runtime — the toggle informs the trustee what to set on next deploy; an in-app `getEffectiveAccessMode()` reads the cell and surfaces it on the admin screen.)

**FR-15 (Conflict toast on simultaneous writes).** If `recordCheckin` for `(sessionId, callsign)` finds an existing row written by a different NCO email within the last 60 seconds, the second NCO receives a non-blocking toast ("K7ABC was already logged by W7DEF a moment ago") and the row is preserved.

**FR-16 (Handoff).** Server function `claimSession(sessionId)` lets a new NCO take over an Open session. The session's `NCOCallsign` history is appended to a `HandoffLog` column; subsequent `Checkins.LoggedByNCO` reflect the new operator.

---

## Non-functional requirements

- **Performance.** ≤3 s median, ≤5 s p95 from "callsign in air" to row visible in the local log. Sync to Sheet is async and not on this critical path. Local Suffix-Tap resolution against the IndexedDB roster is ≤200 ms perceived for rosters up to ~500 entries.
- **Scale.** Up to 50 participants per net; up to ~260 nets/year × 5 years ≈ 13,000 `Checkins` rows — well within Google Sheets row limits. `Roster` tab sized for ~500 callsigns (WashCoARES member ceiling).
- **Accessibility.** WCAG 2.1 AA. Minimum tap target 48 × 48 px. High-contrast palette tested against `prefers-contrast: more`. Visible focus rings. Screen-reader labels on all interactive elements. The Suffix-Tap keypad must be reachable with a single thumb on a phone held in either hand.
- **Security & privacy.**
  - All data resides in the WashCoARES Workspace (Drive, Sheet, PropertiesService). No third-party storage.
  - OAuth scopes limited to: `https://www.googleapis.com/auth/spreadsheets` (for the app's own Sheet), `https://www.googleapis.com/auth/drive.readonly` (for the Sunday-Sync CSV folder, narrowed where possible), `https://www.googleapis.com/auth/script.send_mail` (for EC emails), `https://www.googleapis.com/auth/userinfo.email` (for `Session.getActiveUser`), `https://www.googleapis.com/auth/script.external_request` (for FCC/HamDB resolver). Re-evaluate each scope before deployment per project `CLAUDE.md`.
  - PII is callsign + name (both already public per FCC), plus the authenticating Google account email of the NCO (internal accountability only). No location, no traffic content, no narrative.
  - HtmlService templates render all user-controlled values via `<?= value ?>` (auto-escape). `<?!= ?>` is forbidden in v0 and treated as a defect.
  - Secrets (EC email, ActivARES Drive folder ID) live in `PropertiesService.getScriptProperties()`, not source.
- **Multi-tenant / scoping.** Single tenant — WashCoARES Workspace. Per-NCO accountability captured via `Session.getActiveUser().getEmail()`; the app does NOT carve per-NCO data partitions.
- **i18n / localization.** English only at v0. Times stored as ISO-8601 UTC; displayed in the user's local time zone.
- **Offline / degraded modes.** Full PWA. IndexedDB caches the roster snapshot at session start. Check-ins write to IndexedDB first; a background sync flush pushes to the Sheet whenever connectivity returns. The End-Net screen explicitly surfaces unsynced rows and blocks End-Net commit until the queue drains (or the NCO explicitly accepts "End now, sync later").
- **Retention.** 5 years rolling auto-purge of detail rows. `MonthlyTotals` retained indefinitely. Right-to-be-forgotten: a trustee-run admin script deletes all rows for a specified callsign on request.

---

## Success metrics

| Metric | Target | Measurement |
|---|---|---|
| Time from "callsign in air" → row in local log | Median ≤ 3 s, p95 ≤ 5 s | Client-side stopwatch on a 5-net dogfood study; NCO speaks the callsign and taps a stopwatch when the row shows |
| Roster-hit rate (Sunday-Sync only) | ≥ 90% of check-ins | `Checkins` rows where `Source = 'RosterCache'` ÷ total, per net, averaged across 4 consecutive nets |
| Async resolver success rate | ≥ 80% of unknowns resolved within 24 h | `UnknownCallsigns` rows transitioning `pending` → `resolved` within 24 h |
| NCO satisfaction (qualitative) | ≥ 4/5 from each of 3 distinct rotating NCOs | Post-net survey, three questions, free-text |
| End-Net email delivery | 100% (or backed-off retry succeeds within 24 h) | Trigger log + EC inbox audit |
| Monthly report on time | 100% by 09:00 local on the 1st | Trigger log |
| Sheet write success under load | 100% within session (LockService-serialized) | Apps Script execution log; zero unhandled exceptions per net |

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ActivARES CSV pipeline never built, breaks, or schema-drifts | Medium | High (no roster = no Suffix-Tap match path) | Sunday-Sync emails trustee on validation failure; manual paste-into-`Roster` is the documented fallback; brainstorm flagged this as #1 day-one killer |
| FCC ULS / HamDB.org rate-limits or goes down | Medium | Low (async path, doesn't block check-ins) | Hourly trigger with backoff; failed lookups stay `pending` and retry next hour; not on critical path |
| `MailApp` daily-quota exhausted on a busy day | Low | Medium (EC summary missed) | Catch quota error; queue email in `PropertiesService`; retry next day; show "summary pending" on End-Net screen |
| Suffix collisions during a real activation (many similar calls) | Medium | Medium (NCO falls back to typing the full suffix or picking from a 5-item list) | Candidate-list UX (G5) handles up to ~5 collisions cleanly; NCO can type one more char as escape valve |
| Concurrent NCO writes race the LockService timeout | Low | Low (second write retries) | `tryLock(10000)` with exponential backoff; first-write-wins for the same callsign event with a conflict toast (FR-15) |
| Apps Script 6-minute limit hits the async resolver on a backlog | Low | Low (resolver resumes next hour) | Checkpoint pattern in `PropertiesService`; resolver processes in batches and yields on time-budget warning |
| IndexedDB / PWA install fails on a phone the NCO uses for the first time mid-net | Medium | High (NCO falls back to paper) | First-run flow at home/on-boarding; once installed, app is offline-resilient; paper-backfill flow (FR-10) captures the lost session post-hoc |
| "Anyone with link" access at v0 lets a stranger graffiti the Sheet | Low | Medium | All writes are LockService-serialized and authenticated (`USER_ACCESSING`); every row stamps `NCOEmail`; trustee can audit and purge; trustee toggles to `domain` access mode (FR-14) when ready |
| Stale roster (Tuesday-licensed ham checks in Thursday) | Medium | Low (handled by async resolver) | Treated as unknown, async-resolved (G21); next Sunday-Sync auto-corrects |
| "Hours" measure has no real consumer | Low (mitigated by user research) | Would-be-high | User confirmed: EC sends monthly report up the chain. Brainstorm killer #2 is closed. |
| Callsign-only omits fields a real activation might need | Medium | Low at v0, growing over time | Free-text Purpose/Notes on the session itself covers v0; a future v1 could add per-event notes if real activations demand it |

---

## Implementation hints

(Loose — refined in `/eg-new-feature`.)

**Layer ordering for build:**

1. **Sheet schema first.** Create the `Sessions`, `Checkins`, `Roster`, `RosterFallback`, `UnknownCallsigns`, `MonthlyTotals`, `Config` tabs in a template Sheet. Validate column types and freeze headers.
2. **Server functions next.** All `google.script.run` server entry points (`startSession`, `recordCheckin`, etc.) with `LockService` and jest-mocked Apps Script globals. No UI yet.
3. **`sundaySync` trigger.** Wire the Drive folder reader, the CSV validator, and the `Roster` tab writer. Trustee can manually drop a CSV and watch it land.
4. **Async resolver.** FCC ULS / HamDB.org client with checkpoint pattern. Standalone test against a CSV of known unknowns.
5. **Front-end shell.** HtmlService templates for Start / Logging / End screens. Stub the Suffix-Tap keypad with a `<select>` placeholder to validate the round-trip end-to-end.
6. **Suffix-Tap keypad.** Thumb-zone layout, IndexedDB integration, candidate-list collision UX. This is the hardest UX surface; iterate against a paper-mock of a 15-station net before coding fully.
7. **PWA / offline.** Service worker, IndexedDB cache of the roster snapshot, background sync. Last because it's the most testing-sensitive layer.
8. **Monthly trigger + auto-email.** Build last; mock dates to validate.

**Apps Script globals to mock in jest:** `SpreadsheetApp`, `DriveApp`, `UrlFetchApp`, `MailApp`, `Session`, `LockService`, `PropertiesService`, `ScriptApp`, `Logger`.

**`appsscript.json` deployment block:** `executeAs: USER_ACCESSING`, `access: ANYONE` (toggleable per FR-14). Time zone: `America/Los_Angeles` (verify with user before commit). V8 runtime.

**Idempotency:** every server function must be safe to call twice with the same arguments (network flake → client retry). `recordCheckin` keyed on `(sessionId, callsign, clientTimestamp)` ignores duplicates.

**Trigger dedup:** before installing any time-driven trigger, loop `ScriptApp.getProjectTriggers()` and delete matching ones. Never assume a fresh project — installs are additive.

---

## Open questions

These were not blocking the PRD but should be answered before `/eg-new-feature` or as the design unfolds:

1. **ActivARES CSV exact schema and exact delivery cadence.** PRD assumes `Callsign,Name,LicenseClass` and a weekly drop. Trustee confirmation needed before `sundaySync` is built.
2. **EC's exact email address and the desired email subject-line format.** Stored in `Config` / `PropertiesService` — needs the actual values.
3. **Time zone.** Assumed `America/Los_Angeles`; confirm before committing `appsscript.json`.
4. **Repeater list — free-text or controlled vocabulary?** PRD lists it as free-text in `Sessions.Repeater`. A dropdown of the 3-5 common WashCoARES repeaters might be friendlier; flag for `/eg-new-feature` UX pass.
5. **Net type — free-text or controlled vocabulary?** Same question. Suggested controlled list: `Sunday Practice`, `Skywarn`, `ARES Drill`, `ARES Activation`, `Other (specify)`.
6. **Should the End-Net email also CC the NCO?** Currently to-EC only. Trivial change either way.
7. **Where does the `Config` tab's `ECEmail` and `RosterCsvDriveFolderId` get edited?** A protected tab the trustee can edit, or a `Settings` admin panel in the app. Tab is simpler at v0.
8. **First-run / onboarding for an NCO opening the app on a brand-new phone.** PWA install flow needs a documented "do this once at home" path; UX detail for `/eg-new-feature`.
9. **`asyncResolveUnknowns` hourly cadence — is hourly right, or should it be on End-Net to provide faster name fill on the EC summary email?** Trade-off: hourly is simpler and respects FCC/HamDB politeness; on-demand at End-Net gives the EC nicer-looking summaries.

---

## Sources & references

- **Primary brainstorm (this product):** [`plans/eg-brainstorms/nco-callsign-only-2026-05-11.md`](../eg-brainstorms/nco-callsign-only-2026-05-11.md) — Suffix-Tap, Sunday-Sync, side-store concepts; the "three things that could kill this" list; user-supplied answers to ActivARES / hours / traffic / log-exists / Workspace-control questions.
- **Prior brainstorm (superset of NCO concept space):** [`plans/eg-brainstorms/nco-checkin-hands-2026-05-10.md`](../eg-brainstorms/nco-checkin-hands-2026-05-10.md) — six broader UX shapes (voice, gesture, strip-bay, queue), hardware/network tier analysis (A/B/C/D), and the rejected modalities (voice STT, ATC-style strips) that this PRD explicitly defers to future PRDs.
- **Project conventions:** [`CLAUDE.md`](../../CLAUDE.md) — Apps Script + HtmlService + TypeScript stack, the always-on Apps Script + Workspace constraints (6-minute limit, OAuth scope minimization, HtmlService XSS, LockService, PropertiesService scoping, `Session.getActiveUser`, trigger dedup).
- **External references cited in the source brainstorm** (not re-verified by this PRD; verify before relying on them at implementation time):
  - ARRL discontinued ARES Connect in January 2021 — informs "amateur radio rolling-attendance tooling is sparse" framing.
  - HamDB.org JSON API and FCC ULS bulk export — candidate fallback identity sources for `asyncResolveUnknowns`.
  - Apps Script V8 runtime documentation — applies to all server code.

---

## Out-of-scope follow-ups

Captured here as future PRDs, not built in v0:

- **Voice / STT input** (from prior brainstorm: Phonetic Capture, Roger Roger, Voice-Pick Confirm-Back). Worth re-evaluating once Suffix-Tap has live data on collision rates and NCO speed.
- **ATC-style spatial UI** (Strip Bay, Two-Tap radial pie) — still on the table for a different deployment context (agency desktop with mouse).
- **Traffic-log entries** (ICS-309 / origin → destination → precedence). If a real activation needs message logging, this is the next PRD.
- **ARRL Form 2 export / integration.**
- **Multi-NCO truly concurrent logging** on the same session (vs. sequential handoff in v0).
- **Per-participant variable hours** based on actual time-on-air (vs. flat 0.5).
- **Promotion of resolved callsigns into the upstream ActivARES roster.** Currently the side-store stays separate by design.
- **Cross-county / multi-tenant deployment.** v0 is WashCoARES-only.
