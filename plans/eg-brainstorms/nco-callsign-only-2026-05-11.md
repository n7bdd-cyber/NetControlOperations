# Concepts Brief — NCO callsign-only logger (WashCoARES Workspace)

**Date:** 2026-05-11
**Source:** `/eg-brainstorm` — three parallel goldfish lenses (UX, Technical, Contrarian), then elephant synthesis
**Stage:** Raw concept
**Breadth:** ~5 concepts, deeper (6 surfaced — 2 per lens)
**Web research:** On, focused
**Related prior work:** `plans/eg-brainstorms/nco-checkin-hands-2026-05-10.md` — a broader "hands-busy NCO" brainstorm covering the same project. This 2026-05-11 round is a sharper, narrower take: callsign-only input, ActivARES as identity backbone, "easiest logging app ever created" as north star, hours as the explicit deliverable.

---

## Seed

- **The thought:** A Net Control logging web app on WashCoARES Google Workspace that auto-records check-in hours and participant callsigns, optimized for one-handed operation, where the NCO's only input is a callsign and the app auto-resolves the name (via ActivARES first, then a local-to-this-app store for callsigns ActivARES doesn't know).

- **What I think the user is really asking:** Strip the NCO logger down to its absolute minimum surface — one input, one act — and lean on ActivARES as the identity backbone so the NCO never types a name or a clock value. "Easiest logging app ever created" is the north star; everything else is removable.

- **Constraints:**
  - Audience: WashCoARES Net Controllers (subset of the wider ARES audience). Rotating volunteer role.
  - Deployment: WashCoARES Google Workspace (Drive / Sheets / Apps Script) is the host.
  - Identity source of truth: ActivARES. Read callsign → name from ActivARES first; fall back to a private side-store for non-ActivARES guests, scoped to this app only (not pushed back to ActivARES).
  - One-handed: NCO's other hand is on the mic/PTT. Single visible input: callsign. Name, check-in time, net session ID — all derived.
  - Output deliverable: participant-hours per net, auto-totalled, written somewhere durable (Drive/Sheet).
  - PII: callsign + name; "stored only for this purpose" implies no sharing back to ActivARES, no cross-app use, clear retention story.
  - Stack: Per project `CLAUDE.md` — Apps Script + HtmlService + TypeScript; PWA-leaning per the 2026-05-10 brief.

- **Success criterion:** 5 distinct *shapes* for "callsign is the only input" — each making a clear bet on (a) what the NCO actually types/says/taps to enter a callsign one-handed, (b) where the ActivARES lookup lives, (c) how the unknown-callsign side-store stays trustworthy, (d) what the auto-recorded hours artifact looks like.

- **Out of scope:**
  - The dual-modality "voice AND spatial" decision from the 2026-05-10 brief.
  - Multi-NCO handoff mechanics.
  - The full OpenClaw + Ollama + Whisper LAN-box stack.
  - ICS-309 export and after-action artifacts beyond the participant-hours total.

---

## ⚠️ Loud flag before the clusters

Two of three goldfish could not verify **ActivARES** as a current, maintained, programmatically-accessible service in 2026. The contrarian goldfish notes ARRL killed *ARES Connect* in January 2021 (different product, same space) and could find no public footprint for "ActivARES" by name. **The identity backbone may be a dependency you don't own and can't independently confirm exists.** Every concept below has to answer "and if ActivARES doesn't have an API?"

The single conversation that disambiguates the most downstream design — with the WashCoARES trustee, about what ActivARES actually emits (API? CSV? web form? person?).

---

## Clusters

The six concepts split along three orthogonal axes — **input mechanic**, **identity architecture**, and **what the artifact actually is**. The orthogonality is useful: the v0 will likely be one pick from each axis, not one pick total.

### Cluster A — Input mechanic (what the NCO's free hand does)

- **Suffix-Tap — Three Keystrokes to a Logged Check-In** *[lens: UX]*
  Type only the last 2-3 characters of the callsign on a thumb-zone keypad; resolves against (recent attendees ∪ ActivARES ∪ local-unknowns) in that order. Three keystrokes + LOG. Leans on the fact that ~30 recurring stations dominate any weekly net's name space. **Failure mode:** suffix collisions; visitors/DX don't benefit; collision branch must be solvable one-handed without breaking flow.

- **Phonetic Pull — Two-Tap Tree Down the NATO Alphabet** *[lens: UX]*
  Tap NATO phonetic tiles ("Whiskey", "Seven", "Bravo"…) in the order heard, against the union trie. *Passive* commit — when candidate set = 1, the app auto-logs with a 1.5 s undo bar. NCO never decides when to commit. **Failure mode:** mishearing into auto-commit; bigger tile grid pushes some targets out of thumb zone on phones.

### Cluster B — Identity architecture (where the name comes from)

- **Sunday-Sync Roster Cache** *[lens: Technical]*
  Weekly Apps Script trigger pulls the ActivARES roster into a Workspace `Roster` Sheet; PWA loads it into IndexedDB at launch. All in-net lookups are local. Network can die mid-net and nothing changes. Degrades to "trustee drops a CSV every Sunday" if ActivARES has no programmatic export. HamDB.org JSON + FCC ULS weekly bulk fill the gaps in a separate `RosterFallback` tab so the source of truth stays separable. **Failure mode:** stale roster — a Tuesday-licensed ham shows up Thursday and lands in `UnknownCallsigns`.

- **Edge-Resolved Live Lookup with Apps Script Proxy Cache** *[lens: Technical]*
  Apps Script `resolveCallsign()` cascade: `CacheService` → `PropertiesService` → ActivARES → HamDB.org → FCC ULS Sheet mirror. Always-fresh, no sync moment, layered cache means most check-ins resolve in ~200 ms typical, ~2 s cold. **Failure mode:** a never-before-seen callsign during a network outage falls all the way through the cascade and the NCO is back to typing a name — exactly the failure the product is meant to prevent.

### Cluster C — Reframes (the artifact is the wrong shape)

- **Traffic Tally, Not Roster** *[lens: Contrarian]*
  The served agency buys *traffic handled*, not *warm bodies on frequency*. Make the primitive a comm-log entry (origin → destination → precedence → time, ICS-309-shaped); attendance and hours fall out as side effects. **Failure mode:** most weekly WashCoARES nets are check-in-only with no traffic, so the traffic primitive makes the common case harder.

- **No-Database Net Log (Listener-Confirmed Identity)** *[lens: Contrarian]*
  Drop in-net identity resolution entirely. Capture only `(timestamp, literal callsign string)`. Resolve names *after the net*, asynchronously, against whatever roster exists. Works identically whether the cloud is up, down, or ActivARES was shut down last Thursday. **Failure mode:** NCO loses the live "wait, did K7XYZ just check in twice?" disambiguation — the cognitive load callsign-only was supposed to eliminate.

---

## Ranked picks (elephant's view)

The strongest v0 is probably one input mechanic + one identity architecture + a deliverable shape resolved against the contrarian flags. Ranking the individual concepts:

1. **Sunday-Sync Roster Cache** — Highest leverage on the highest-uncertainty question. If ActivARES turns out to be a CSV the trustee exports manually (very possible given the technical goldfish couldn't find a public API), this concept already accommodates that without any rework. It also keeps the app **offline-immune**, which matters more for ARES than for the typical web app.
   - **Validation step:** one conversation with the WashCoARES trustee about what ActivARES actually emits.

2. **Suffix-Tap** — Cleanest answer to "easiest logging app ever" for the dominant case (recurring 30-station weekly net). Three taps and commit is unbeatable when the NCO is already talking. Active commit (vs. Phonetic Pull's passive) is the safer bet at v0 because mishears under load are real and undo bars get ignored.
   - **Validation step:** time five recurring NCOs against a paper log on a 15-station net.

3. **Traffic Tally, Not Roster** — Not the v0, but the **single most important question to answer before scoping the v0**. If WashCoARES nets DO move enough traffic that a comm-log artifact would be more valuable to the agency than an attendance roll, the whole product reorients around it.
   - **Validation step:** ask the WashCoARES emergency coordinator what artifact the served agency actually reads after a real activation.

**Honorable mentions:**

- **Edge-Resolved Live** would beat Sunday-Sync if ActivARES has a real, reliable API — but the "if" is doing too much work. Reconsider if the trustee confirms a live endpoint.
- **No-Database Net Log** is the right answer if "in-the-moment name resolution" turns out to be a feature you can live without — worth holding in reserve as the maximum-resilience fallback shape.
- **Phonetic Pull** is the more interesting UX bet but a riskier v0 than Suffix-Tap — passive auto-commit is novel enough to want validation before committing.

---

## What the goldfish agreed on

- **ActivARES is the load-bearing unknown.** Two of three couldn't verify it independently; the third (UX) accepted it as given without checking. The team's confidence in this dependency is currently higher than the external evidence supports.
- **The side-store needs an audit/provenance trail.** All technical thinking converged on append-only, NCO-callsign-as-provenance, trustee-only promotion to roster. None of the concepts treated the side-store as an unstructured scratchpad.
- **Google Sheets is the durable artifact.** Every concept that wrote anything wrote it to Sheets — the disagreement is about *when* and *what shape*, not whether.

## What they disagreed on

- **Active vs. passive commit.** Suffix-Tap's LOG button vs. Phonetic Pull's "uniqueness triggers auto-commit." Passive is more novel and more elegant; active is safer when mishears happen. Highest-impact UX fork.
- **Sync vs. live lookup.** Sunday-Sync is the resilience-first bet; Edge-Resolved is the freshness-first bet. The right answer depends on the ActivARES-API question, which is upstream of both.
- **Is "callsign" even the right primitive?** Five concepts assume yes; the contrarian's Traffic Tally says no — the primitive is *traffic*, not roster, and attendance falls out. Disagreement is at the level of the seed itself, not the implementation.

---

## Three things that could kill this concept on day one

From the contrarian lens — warnings worth carrying into the PRD step:

1. **ActivARES turns out to be unmaintained, WashCoARES-local, or shut-down-on-a-Tuesday** — and there is no documented contract, SLA, or fallback for the identity backbone the entire UX is built around.
2. **The "hours" deliverable has no consumer** — once you ask "who reads the hours, and what decision do they make with them?" the answer may be "nobody, it's performative reporting" or "ARRL's post-2021 Form 2 system, which the NCO already fills out manually anyway."
3. **Callsign-only input silently omits the fields a served agency or post-incident review actually needs** — signal report, location, traffic precedence, emergency-vs-routine — and the "easiest ever" framing makes adding those fields back feel like *regression*, locking the app into a shape that can never grow into a real ICS-309 substitute.

---

## Open questions for the user (only you can answer)



| # | Question | Why it gates downstream |
|---|---|---|
| 1 | What is ActivARES, mechanically? (Documented API? WashCoARES-internal Apps Script app? CSV the trustee emails on Sundays? Web form that needs scraping?) | Determines whether Sunday-Sync or Edge-Resolved is even viable. |
|  | ANSWER: WashCoARES internal Apps Script app. |  |
| 2 | Who reads the auto-totalled hours, and what decision do they make with them? (ARRL Form 2? Agency liaison? Grant compliance? Nobody?) | If "nobody," the hours feature is performative and should be cut from v0. |
|  | ANSWER: The Emergency Coordinator sends a report up the chain-of-command every month, with the number of events and member hours. |  |
| 3 | Are WashCoARES nets traffic-heavy or check-in-only? | The Cluster C question. If the served agency cares about messages moved, Traffic Tally reorients the whole product. |
|  | ANSWER: check-in only. |  |
| 4 | Is there an existing paper or spreadsheet log we can look at? | The actual current artifact tells us what the agency is used to seeing — the easiest "easiest app ever" might be the one that produces something they already recognize. |
|  | ANSWER: There currently is no log to look at. |  |
| 5 | Is the WashCoARES Workspace under WashCoARES control, or shared with the served agency / county IT? | Affects OAuth scope, who can grant permissions, and whether the side-store can hold PII. |
|  | ANSWER: WashCoARES control only. |  |





---

## Goldfish lens summary

| Lens | Concepts produced |
|---|---|
| User experience | Suffix-Tap · Phonetic Pull |
| Technical / architectural | Sunday-Sync Roster Cache · Edge-Resolved Live Lookup |
| Contrarian / pre-mortem | Traffic Tally, Not Roster · No-Database Net Log (+ three day-one kill warnings) |

**Suggested next step:** Answer Open Question #1 (what is ActivARES?) and Open Question #2 (who reads the hours?) before running `/eg-prd`. Both have the power to change which concept above is even being scoped. After that: `/eg-prd "WashCoARES NCO callsign-only check-in logger — Sunday-Sync roster + Suffix-Tap input, hours auto-totalled to Workspace Sheet"` (or whatever the answers point to).
