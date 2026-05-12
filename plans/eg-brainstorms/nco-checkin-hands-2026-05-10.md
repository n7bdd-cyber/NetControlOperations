# Concepts Brief — NCO Check-in Logger (hands-constrained)

**Date:** 2026-05-10
**Refined:** 2026-05-10 — user supplied ARES context, hardware / network tiers, dual-modality decision, and LAN AI architecture (OpenClaw + Ollama + Whisper.cpp + cached ULS)
**Source:** `/eg-brainstorm` — three parallel goldfish lenses, then elephant refinement with user
**Stage:** Refined concept — ready for `/eg-prd`
**Breadth:** ~5 concepts, deeper
**Web research:** On, focused (note: web tools were denied / inconsistent during the initial goldfish run — see caveat below)

---

## Seed

- **The thought:** An Amateur Radio Net Check-in log that optimizes the Net Control Operator's time and the constraint of two hands — one of which is committed to operating a microphone.
- **What the user is really asking:** How can software remove friction for an NCO who has roughly one free hand (and one busy hand on the PTT/mic) during a live, time-pressured radio net — so they can capture call signs, names, locations, and traffic items without falling behind the air?
- **Constraints:**
  - Audience: Amateur radio operators acting as NCO on a directed net (likely VHF/UHF repeater, possibly HF; weekly or daily cadence)
  - Hardware reality: transceiver + hand mic OR boom/desk mic with footswitch; laptop/desktop nearby; some have headsets
  - Tech stack: Google Workspace web app (Apps Script + HtmlService + TypeScript per project CLAUDE.md)
  - Pace: 5–20 check-ins in bursts; phonetic call signs; error-prone transcription
  - Output: a usable log (call sign, name, QTH, comments, time) the NCO can re-read mid-net to recognize stations again
- **Success criterion:** A brief surfacing 5 distinct *shapes* the app could take — not five variations on a typed form — each making a clear bet on which input modality buys the NCO the most time back.
- **Out of scope:** Contest/DXing loggers; rig CAT-control as primary feature; export format; multi-NCO handoff.

> **Caveat on sources:** all three goldfish reported web tools were denied or inconsistent this session. Specific claims about NetLogger / N3FJP / Net Notebook / Vocollect / FAA EFSTS are based on the goldfish's domain knowledge (training data, cutoff January 2026), not live verification. **Verify before quoting in any doc downstream.**

---

## Clusters

The six concepts the goldfish surfaced collapse into two themes — **voice as primary input** vs. **spatial / gesture / keystroke as primary input** — with a shared rejection of the "form-with-rows" layout that every existing tool uses.

### Cluster A — Voice as primary input

- **Phonetic Capture, Eyes-Up** *[lens: UX]* — NCO speaks the call sign back into a *separate* dictation mic (not the PTT mic) as part of normal protocol; browser STT (Web Speech API in Chrome — note: Chrome routes audio to Google servers, so it is online-only; Firefox support is partial; a server-side Whisper.cpp is the more portable path) parses the closed NATO/ITU phonetic grammar; screen renders a glanceable stack of the last 3 stations in 48-pt cards, not a form. Free hand only intervenes for corrections via a single physical button (footswitch / single key).
- **Voice-Pick Confirm-Back** *[lens: Adjacent — borrowed from Honeywell Vocollect Voice / Lucas Systems' Jennifer warehouse picking]* — System passively taps the *rig* audio. The NCO's existing protocol utterance ("W7ABC, you're number three, stand by") IS the log entry. Cached FCC ULS lookup auto-fills name + city + license class; free hand only taps to cycle through phonetically-confusable letters when STT mishears.
- **Roger Roger** *[lens: Prior art]* — Positioned as "Otter.ai for nets." Always-listening browser app, ham-tuned STT, single-tap confirmation. Beachhead = social rag-chew nets where STT errors are forgiving; graduates to ARES later.

> *Voice-Pick Confirm-Back* and *Roger Roger* are architecturally similar (both listen to rig audio). They differ in positioning: Voice-Pick is a workflow protocol (confirm-back as the gesture), Roger Roger is a product category framing (copilot). *Phonetic Capture* is the genuinely distinct architecture in this cluster — separate desk mic, only the NCO's voice, no rig cable needed.

### Cluster B — Spatial / gesture / keystroke as primary input

- **The Strip Bay** *[lens: Adjacent — borrowed from ATC flight progress strips — NAV CANADA EFSTS / EXCDS, FAA TFDM]* — Three vertical lanes: *Calling / Working / Logged*. Each check-in is a Post-it-sized card. Free hand drags cards lane-to-lane; traffic items get scribbled on the card with trackpad/stylus. No form; the spatial position of the card IS the status.
- **The Queue, Not the Form** *[lens: UX]* — Single keystroke (F1) captures the last 4 seconds of rig audio + timestamp into a numbered queue slot. Screen shows `(1)[audio·0:04] (2)[audio·0:03] (3)[audio·0:02]`. NCO calls "station number one" reading from the queue, fills in details *after* the burst settles — closer to how 911 dispatchers actually work (capture → classify, not type-while-listening).
- **Two-Tap Net** *[lens: Prior art]* — iPad-on-the-desk radial-pie UI. Top 30 next-actions arranged on a 3-ring pie around the thumb's resting position; thumb never moves more than ~2 cm. No voice. Beachhead = Skywarn and ARES drill NCOs who already run one-handed because the other hand holds a paper map or clipboard.

---

## Ranked picks (elephant's view)

1. **Phonetic Capture, Eyes-Up** — Most direct attack on the constraint and the only voice concept that does NOT require a rig-to-PC audio cable. The NCO's protocol-trained habit of speaking the call sign back is *already happening* — it becomes free data on a clean boom-mic channel. Closed core vocabulary (Alpha–Zulu + Zero–Niner = 36 tokens; ~20 common ham terms push the practical core to ~56; prosigns, signal reports, and QTH city names push it higher) is still a constrained-grammar STT problem and friendly to phrase biasing. **Caveat:** Chrome's Web Speech API is online-only and `SpeechRecognitionPhrase` support varies across browsers; a server-side Whisper.cpp with custom grammar biasing is the more portable path.
   - **Validation step:** prototype the STT path against ~10 minutes of recorded NCO acknowledgments under typical home-shack noise and measure word error rate before committing.

2. **The Strip Bay** — Strongest non-voice concept. Zero STT risk, distinctive UX, leans on a 70-year-proven mental model that has survived multiple "just digitize it" attempts in higher-stakes ATC. Could ship as v0 and have voice features layered on later.
   - **Validation step:** wireframe the three-lane layout and the card-spawn moment (the actual bottleneck per the goldfish), then walk a real NCO through a paper mock of a 10-station burst.

3. **The Queue, Not the Form** — Pragmatic third option that accepts the NCO *cannot* transcribe in real time and reshapes the workflow around triage-then-fill. The hardware dependency (rig audio path) is real and noted as the dominant adoption risk by the UX goldfish itself.
   - **Validation step:** ask 3-5 NCOs whether they already have rig audio routed to their PC; if <50%, this concept's beachhead is much narrower than it looks.

---

## Refinement — 2026-05-10 (elephant + user)

After the goldfish ran, the user supplied answers and constraints that materially reshape the design space. Captured here so the PRD-stage work has the full picture in one place.

### Confirmed audience and use case

- **Audience:** ARES (Amateur Radio Emergency Service) group. The Net Controller role rotates among trained operators.
- **Cadence:** Weekly practice nets year-round; real activations are the live-fire case the practice exists to prepare for.
- **Primary deployment:** Fixed station at a served-agency facility (EOC, Red Cross, hospital, etc.). The agency owns the bulk of the equipment; a Station Manager keeps it ready on short notice.
- **Practice deployment:** Usually from the operator's home or mobile; may use Echolink (VoIP-to-repeater) when no real rig is at hand.

### Hardware / network reality (user-supplied probabilities)

| Tier | Scenario | Share | What works |
|---|---|---|---|
| A | Agency station, network up (commercial broadband, Starlink, or both) | ~92% real-op | Everything — cloud sync, optional local STT server, browser STT |
| B | Agency station, network intermittent | ~6% real-op | Local-first writes, sync on reconnect; local STT if present |
| C | Agency station, network down (Starlink obstructed / severe weather / dish power lost) | ~2% real-op | Pure local; STT only if local server present |
| D | Home / mobile, network up | majority of practice | Same as A; Echolink may be the audio source instead of a rig |
| E | Mobile real-op, network spotty | rare | Local-first; browser STT unreliable; hand mic doubles as the input device |

- **Mains power:** ~99% reliable. Battery backup is not the dominant design constraint.
- **Internet:** ~99% reliable when agency stations have **Starlink as backup to commercial broadband** (the working assumption). Intermittent rather than absent is the dominant degraded case.
- **Starlink caveat:** the exact severe-weather scenarios ARES exists to support — hurricanes, atmospheric storms, heavy wildfire smoke, ice on the dish — are also when Starlink can degrade (rain fade, dish obstruction, ground-station outage). Don't assume cloud reachability during the worst hours of a real activation.
- **AI cloud access:** usable in normal conditions; not guaranteed during severe activations. The LAN AI box still earns its keep for **latency, privacy of net-traffic content, and the small-but-load-bearing "no internet" window when help matters most.**

### Design direction (user decision)

- **Develop BOTH input methods** — voice (rig-tap path) AND spatial / keystroke (Strip Bay or Two-Tap-style). Operators choose what fits their station and their preference. This intentionally overrides the prior-art goldfish's "pick one" framing because:
  - ARES standardization on a single modality is unrealistic; equipment and operator preferences vary.
  - The underlying data model (a check-in record) is identical for both, so duplication sits at the input layer, not the core.
  - A mobile operator with a hand mic cannot use the desk-mic-based **Phonetic Capture, Eyes-Up** architecture as originally written — voice in a mobile rig needs the rig-tap path (Voice-Pick / Roger Roger style).

### AI / STT infrastructure architecture

Recommended pattern for the agency-station tier: a **LAN-resident AI box** that the agency owns and the Station Manager maintains. With ~99% internet (Starlink-backed), this is no longer primarily an offline-fallback play — it is a **latency, privacy, and rare-but-critical-outage** play. The operator's laptop talks to this box over local HTTP; the box absorbs the "is the cloud reachable today?" question so the PWA does not have to.

| Component | Purpose | Notes |
|---|---|---|
| **OpenClaw** | Self-hosted AI gateway. Unified endpoint that routes to cloud LLMs (Claude / GPT / Gemini) when online, and to local Ollama models when not. | Appears to exist and be active as of 2026 — one web search and one 403'd blog, not strong verification, and not in the elephant's training data. Verify capabilities (especially Whisper / tool-use wiring) before committing in the PRD. |
| **Ollama** | Local LLM runtime for offline operation. | Free, no API keys, runs on commodity hardware. |
| **Whisper.cpp** | Local speech-to-text engine (better quality than browser Web Speech API; offline-capable). | Run as a separate service invoked through OpenClaw's tool-use layer, or directly. |
| **Cached FCC ULS** | Local call-sign → name / city / license-class lookup. | Refreshed when internet is available; usable when not. |

The PWA itself is unaware of cloud vs. local routing — it calls the LAN box, which decides. When the LAN box is unreachable (e.g., home practice with no such box), the PWA falls back to browser STT and the cloud ULS API.

### Practice vs. real-op mode

- **Same UI, swappable audio source.** Real ops use the rig audio path (USB sound card, etc.). Practice from home may use the browser microphone, or Echolink output piped into the browser.
- **The trust loop** ("I trust this tool because I used it in last week's drill") only holds if the workflow is identical across modes. Audio source differs; everything else does not.

### Architectural implications for the project's planned stack

The "Apps Script + HtmlService" framing in `CLAUDE.md` works for online check-in logging but cannot run when Google's servers are unreachable. The refined architecture:

- **Operator-facing app:** PWA (Progressive Web App) — installable, runs offline, stores to IndexedDB locally, syncs to Sheets when online. **Caveat:** iOS Safari has historically evicted IndexedDB after a non-use window; for weekly-cadence drills this is a real data-loss risk to engineer around (scheduled background sync, fallback to OPFS where available, or treating the device store as cache-not-of-record).
- **Apps Script:** the sync target and shared-log host for practice nets; not on the critical path when Google is unreachable.
- **LAN AI box:** orthogonal to the Google stack; talks to the PWA over local HTTP regardless of internet state.

This is a meaningful shift from the original project framing and is worth surfacing explicitly in the PRD.

---

## What the goldfish agreed on

- **The form is the wrong abstraction.** None of three lenses, working independently, proposed "the existing form layout but better" — they all reshaped the central screen object. Strong convergent signal that the dominant incumbent shape (NetLogger / N3FJP) is genuinely off for the hands-busy NCO.
- **Phonetic vocabulary is closed and small** — Alpha–Zulu (26) + Zero–Niner (10) + ~20 core ham terms = ~56 tokens; prosigns, signal reports, and QTH city names push the real operating vocabulary higher. Still a constrained-grammar STT problem and was independently called out by all three goldfish as the technical foothold that makes voice approaches credible in 2026.
- **The "two-hands, one busy" framing is genuinely underserved** — the prior-art lens was explicit that no mainstream NCO tool optimizes for it; the UX and Adjacent lenses arrived at the same conclusion from different directions.

## What they disagreed on

- **Where the audio comes from.** Separate dictation mic (Phonetic Capture) vs. passive rig tap (Voice-Pick / Roger Roger / Queue) — this is the load-bearing architectural fork. The rig-tap path requires a cable + audio config the median NCO may not have set up; the UX goldfish flagged this as a real deal-breaker, the Adjacent goldfish treated it as obvious infrastructure.
- **Voice or layout — pick one.** The prior-art goldfish was explicit that voice-first and radial-thumb layout are mutually exclusive bets appealing to different NCO temperaments (early adopter vs. reliability-first). The Adjacent goldfish made the same point about Strip Bay vs. Voice-Pick. Hybrids dilute both bets.
- **STT trust under repeater audio bleed.** UX goldfish flagged this as unproven; prior-art goldfish was more bullish ("a near-solved problem"); Adjacent goldfish was honest that "wrong-but-confident transcription is worse than no transcription."

---

## Risks and unresolved bets

A destruction-by-counterargument pass on this brief surfaced concerns serious enough that the PRD work needs to engage with them rather than inherit them as defaults. Factual issues identified during the pass were fixed in-place on 2026-05-10; two categories remain that warrant PRD engagement — internal contradictions and counterarguments to the core bets.

### Internal contradictions to resolve in the PRD

- **Multi-NCO handoff** — listed Out of scope in the Seed but the Refinement makes operator rotation explicit. One has to give. ARES context strongly suggests it belongs *in* scope.
- **Trust loop vs. swappable audio source** — "same UI, swappable audio" is contradicted by the practice / real-op STT-accuracy gap. The thing that fails (transcription quality) differs between the two modes; trust learned in practice may be wrong-direction trust.
- **LAN AI box ownership** — the brief specifies the box exists at the agency but never says who buys, installs, secures, or maintains it. Agency IT departments routinely forbid non-standard servers; Station Manager skill sets are rig-not-Linux. Treat ownership / maintenance as a first-class PRD requirement, not an implementation detail.
- **Output goal vs. Strip Bay design** — the Seed wants a log the NCO can "re-read mid-net to recognize stations." Strip Bay's *Logged* lane is an archive; scanning a 30-deep card stack is worse than scanning a tabular row for that purpose. Either the output goal or the spatial-layout pick has to bend.

### Counterarguments to the core bets

| # | Bet | Counterargument |
|---|---|---|
| 1 | "Hands-busy NCO" is the core problem | ARES nets are directed, formal, and slow. Stations check in one at a time on NCS direction; pace is closer to "1 check-in every 10–20 seconds" than "5–20 in bursts." Hands-busy may be a fast-net solution looking for a slow-net problem. Re-scoping around "occasional pressure during traffic handling" would change the design substantially. |
| 2 | "The form is the wrong abstraction" | The goldfish convergence could be a shared LLM bias toward UX novelty. Forms survived 40 years of net logging because they are fast, scannable, trivially exportable to ICS-309 (the actual ARES deliverable), and require no learning curve. Reshaping the central object may cost more in cognitive load and onboarding than it saves in hand-motion. |
| 3 | OpenClaw + Ollama + Whisper + ULS on the LAN | The PWA actually needs **one** thing from the LAN: STT. A 200-line Whisper.cpp HTTP wrapper does the job with one-tenth the moving parts and attack surface. The full OpenClaw stack is feature-led-by-tech, not feature-led-by-need. |
| 4 | "LAN AI box buys reliability" | It also introduces a new single point of failure — rig + box + LAN switch + box power + Linux updates + Whisper memory all in series. Each is reliable; the product is less so. Worse than no box if MTBF is not actively managed. |
| 5 | "Develop both modalities; operators choose" | Two modalities = two input pipelines, two QA matrices, two training docs, two communities of complaint. For a volunteer project the real risk is shipping two half-baked modalities instead of one solid one. The right v0 question is which **single** modality, done well, would change ARES net control. |
| 6 | "Practice builds trust for real ops" | High-stakes performance under cognitive load is famously different from low-stakes practice. Emergency-response literature suggests operators revert to the simplest, most familiar tool under stress. That tool is paper. Designing as if practice-comfort transfers to activation-confidence is how feature-rich emergency tools get abandoned during the emergency. |
| 7 | "Starlink → 99% internet" | The conditional probability that matters is internet-up-*given*-activation, not internet-up-on-a-random-day. The two are very different numbers; the brief currently uses the wrong one. |
| 8 | "Solve the hands-busy problem" | Paper net logs work. The brief never directly answers why paper fails for ARES specifically. The real wins are probably **post-event** (ICS-309 export, multi-station shared view, audit trail, handoff continuity), not in-net typing speed. Reframing around the end-of-net deliverable may change everything upstream. |

### The single question that, if answered first, reframes the rest

> **What does this app produce at end-of-net that an ARES NCO with a paper form cannot?**

Frame the answer as a concrete artifact — ICS-309, shareable live view, searchable cross-net history, NIMS-compliant timestamp chain, station-handoff continuity, post-event after-action-review feed. Whichever artifact the team most values determines:

- whether modality choice matters at all (if the win is post-event, in-net typing speed is secondary)
- what the data model needs (audit fields, multi-operator authorship, served-agency tagging)
- whether sync to Sheets is in the critical path or a convenience
- whether voice STT is core or optional

Engage with this question before settling the PRD's "What we are building" section.

---

## Open questions — status

| Question | Status | Answer / notes |
|---|---|---|
| Target NCO vs. community? | ✅ Resolved | ARES group — community, with rotating operators |
| Net type? | ✅ Resolved | Emergency communications; weekly practice nets |
| Rig audio routed to PC? | ✅ Resolved | Yes for the user's rig and most others |
| Risk appetite — voice first or layout first? | ✅ Resolved | Develop both; let operators choose |
| Per-station peripherals (footswitch, second screen, dedicated dictation mic) | ❌ Open | Per-station inventory needed before STT v1 ships |
| OpenClaw — current release supports the Whisper / tool-use wiring we want? | ❌ Open | Verify with someone on the team who has run OpenClaw before committing in the PRD |
| Multi-operator handoff model — login, identity, rotation | ❌ Open | Surface in PRD scope |
| Echolink audio capture — how does it appear to the browser in practice mode? | ❌ Open | Investigate during practice-mode design |
| Starlink coverage — does every served-agency station actually have Starlink as backup, or only some? | ❌ Open | The ~99% network figure assumes yes; verify per-agency before treating tier-C as ~2% in PRD |

---

## Goldfish lens summary

| Lens | Concepts produced |
|---|---|
| User experience | Phonetic Capture, Eyes-Up · The Queue, Not the Form |
| Adjacent / lateral | The Strip Bay (ATC strips) · Voice-Pick Confirm-Back (Vocollect) |
| Market research / prior art | Roger Roger · Two-Tap Net |

**Next action:** run `/eg-prd "NCO check-in logger for ARES — dual-modality (voice + spatial / gesture), offline-capable PWA, optional LAN-resident AI gateway (OpenClaw + Ollama + Whisper.cpp + cached ULS)"` to convert this refined brief into a PRD.
