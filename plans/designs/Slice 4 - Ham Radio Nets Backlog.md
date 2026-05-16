# Slice 4 — Ham Radio Nets Backlog

## Context

ActivARES already has the schema for net scheduling built into TrainingEvents and Operations (FrequencyID, HfFrequencyID, PhysicalLocationID, OnlinePlatform, OnlineMeetingInfo). The Frequencies and HfFrequencies tables are defined in CreateAndMigrate.gs. What doesn't exist yet: the data, the import function, the scheduling UI, and the net management tools.

This slice delivers the full Ham Radio Net capability: live repeater data from RepeaterBook, a net scheduling interface, support for all linking technologies (EchoLink, IRLP, AllStar, D-Star, DMR, YSF, Hamshack Hotline, Hams Over IP), HF net reference data, and net-control operator tracking.

---

## Schema already in place (no changes needed)

| Table | Key fields | Purpose |
|---|---|---|
| `Frequencies` | FrequencyID, Callsign, Frequency, Offset, Tone, Mode, Band, Linked, OpStatus, RBID, Alias, Channel | VHF/UHF repeaters — source of truth for On-Air events |
| `HfFrequencies` | HfFreqID, Frequency (MHz), Mode, NetName, Schedule, Alternate (MHz), Notes | HF net reference (manually maintained) |
| `Locations` | LocationID, LocationName, Address, AgencyID, Notes | Physical venues |
| `TrainingEvents` | EventID, Series, Topic, Date, FrequencyID, HfFrequencyID, PhysicalLocationID, OnlinePlatform, OnlineMeetingInfo | Scheduled training sessions, including nets |
| `Operations` | OperationID, EventName, Type, FrequencyID, HfFrequencyID, PhysicalLocationID, OnlinePlatform, OnlineMeetingInfo | Activations and exercises |

---

## Linking technology map (see DECISIONS.md 2026-05-15 for full rationale)

| Technology | Stored in | Notes |
|---|---|---|
| EchoLink | `Frequencies.Linked` + `OnlinePlatform` | Node# from RepeaterBook; also usable standalone |
| IRLP | `Frequencies.Linked` | Node# from RepeaterBook |
| AllStar | `Frequencies.Linked` | Node# from RepeaterBook |
| WIRES-X | `Frequencies.Linked` | YSF node# from RepeaterBook |
| D-Star | `Frequencies.Mode` | Digital repeater mode; uses FrequencyID, not OnlinePlatform |
| DMR | `Frequencies.Mode` | Digital repeater mode; uses FrequencyID, not OnlinePlatform |
| Yaesu System Fusion | `Frequencies.Mode` | Digital repeater mode; uses FrequencyID, not OnlinePlatform |
| Hamshack Hotline | `OnlinePlatform` dropdown | No repeater tie; dial-in extension in OnlineMeetingInfo |
| Hams Over IP | `OnlinePlatform` dropdown | No repeater tie; connection details in OnlineMeetingInfo |

---

## Backlog items

### B4-1 — RepeaterBook import (HIGH — enables everything else)

**Goal:** Populate the Frequencies sheet with live repeater data for Washington County (and surrounding counties for white-label flexibility).

**Deliverable:** `src/RepeaterBook.gs` — new file.

**Function:** `loadFrequenciesFromRepeaterBook()` — zero-arg, run-mode controlled by `RB_CONFIG.DRY_RUN` at top of file.

**Token:** stored in Settings sheet key `RepeaterBookToken` — never hardcoded.  
**User-Agent:** `ActivARES/1.0 (+https://washcoares.org; briandarby@pm.me)`  
**Endpoint:** `https://www.repeaterbook.com/api/export.php?country=United%20States&state=Oregon&county=Washington`  
**Header:** `Authorization: Bearer <token>` (email confirmed this over X-RB-App-Token)

**Column mapping from RepeaterBook JSON → Frequencies table:**

| RepeaterBook field | Frequencies column | Notes |
|---|---|---|
| `callsign` | Callsign | |
| `frequency` | Frequency | RX freq (MHz) |
| offset derived from `input_freq - frequency` | Offset | |
| `pl_tone` (CTCSS) or `d_tone` (DCS) | Tone | DCS prefixed "D" |
| derived from mode flags | Mode | FM / D-Star / DMR / YSF / NXDN / P25 / M17 |
| VHF if < 300 MHz else UHF | Band | |
| `county` | County | |
| `state` | State | |
| concatenated node numbers | Linked | "EchoLink 123456 / IRLP 4312 / AllStar 27499 / WIRES 12345" — omit blanks |
| `operational_status` | OpStatus | |
| `notes` | Notes | Attributed: "Source: RepeaterBook.com" appended |
| `id` (RB record ID) | RBID | For future re-sync |
| *(blank — filled manually)* | Alias | WC 1, WC 2, etc. |
| *(blank — filled manually)* | Channel | 77, 78, etc. |

**Dedup strategy:** Option C (append-new-only). Match by RBID — skip any row already in Frequencies. Never overwrite existing rows. Decommissioned repeaters are removed manually.

**Test:** `testRepeaterBookImport()` in TestFunctions.gs — dry run confirms log output; live run confirms rows added; re-run confirms idempotence (zero new rows).

---

### B4-2 — HF Frequencies seed data (MEDIUM)

**Goal:** Populate HfFrequencies with the ARES/RACES/traffic net frequencies for the Pacific Northwest region.

**Deliverable:** `seedHfFrequencies()` in `RepeaterBook.gs` (or `CreateAndMigrate.gs`) — manual one-time seed.

**Key entries to include:**
- Oregon ARES HF net (3.975 MHz LSB, Sunday 0800 local)
- Region 7 ARES HF (3.985 MHz LSB or similar)
- National Traffic System (NTS) Oregon section net
- Oregon Emergency Net (OEN)
- Other regional ARES/RACES frequencies as Brian provides

**Format:** HfFreqID (HF-0001…), Frequency (MHz), Mode, NetName, Schedule (human-readable e.g., "Sundays 0800 local"), Alternate (MHz), Notes.

---

### B4-3 — OnlinePlatform dropdown expansion (MEDIUM)

**Goal:** Add Hamshack Hotline and Hams Over IP to the `OnlinePlatform` controlled list used in net/event scheduling.

**Current list:** Zoom / Google Meet / MS Teams / Other  
**Expanded list:** Zoom / Google Meet / MS Teams / EchoLink / Hamshack Hotline / Hams Over IP / Other

**Where this matters:**
- TrainingEvents and Operations forms in the UI — the platform picker
- Test data in DemoData.gs — add at least one net using each new platform
- Installer Guide — update the platform list in the net-scheduling section

**Note:** EchoLink is added here specifically for the case where a member participates via the standalone EchoLink app or node (not through a linked repeater). If a repeater carries EchoLink, that's already captured by `Frequencies.Linked` — but a standalone EchoLink conference room (e.g., net on EchoLink conference 95000) is an online platform, not a repeater frequency.

---

### B4-4 — Net scheduling UI (HIGH — user-facing)

**Goal:** Allow EC / NC to schedule a net and specify its technical access details (frequency, linking technology, online platform).

**Entry point:** New "Schedule Net / Event" button on the TrainingEvents view (or repurpose the existing Meetings flow if Track 2 has landed by the time this starts).

**Form fields:**

| Field | Type | Notes |
|---|---|---|
| Series / Net name | text or dropdown from existing Series values | |
| Date | date picker | |
| On-Air? | checkbox | If checked → FrequencyID picker |
| FrequencyID | dropdown populated from Frequencies sheet | Shows Alias + Frequency (e.g., "WC 1 — 145.450") |
| HF net? | checkbox | If checked → HfFrequencyID picker |
| HfFrequencyID | dropdown populated from HfFrequencies | Shows NetName + Frequency |
| Physical location? | checkbox | If checked → PhysicalLocationID picker |
| Online platform | dropdown (B4-3 list) | Nullable |
| Meeting info | free text | Zoom link, Hamshack extension, EchoLink conference#, etc. |
| Instructor / Net Control | member picker | Optional |
| Notes | textarea | |

**After save:** Activity_Log entry. TrainingEvents row created.

---

### B4-5 — Net view / calendar display (LOW — nice to have)

**Goal:** Display upcoming nets with access details so members can tune in.

**Candidates:**
- Read-only view in Index.html (accessible to all logged-in users, not just coordinators)
- Show: net name, date/time, On-Air frequency + linked systems, Online platform, Physical location
- "Copy EchoLink node" / "Copy Zoom link" buttons for quick sharing

**Dependency:** Requires B4-4 (scheduling data must exist before display makes sense).

---

### B4-6 — Net control operator assignment and logging (MEDIUM)

**Goal:** Record who ran net control for each net session, enabling the NCO role history.

**Design:** Attendance or OperationsRoster entry with Role = "Net Control".  
Alternatively, a NetControl column directly on TrainingEvents — simpler for weekly nets.

**Decision pending:** Is net-control tracking important enough to warrant a dedicated flow, or is it a special case of Attendance? Brian decides before implementation.

---

### B4-7 — RepeaterBook.gs version tracking and maintainer note (LOW)

**Goal:** Add `RepeaterBook.gs` to the Installer Guide Step 4 file table and Appendix C (with version, description, and "run loadFrequenciesFromRepeaterBook once at setup" note).

**Dependency:** Requires B4-1 to be complete and tested.

---

## Out of scope (defer)

- Automated net announcements / pre-net emails (defer to Newsletter slice)
- Net parity check (did all expected members check in) — requires Attendance data
- CHIRP / radio programming file export from Frequencies table (Slice 5 or later)
- Integration with ARRL or other national net schedules
- Offline-capable net logging (mobile web app or dedicated tool — out of GAS scope)

---

## Working order

Each item ends with a passing test before the next begins (per CLAUDE.md working rules).

1. **B4-1** — RepeaterBook.gs + `loadFrequenciesFromRepeaterBook()` + `testRepeaterBookImport()`. Dry run reviewed, live run confirmed, idempotence confirmed. **Pause.**
2. **B4-3** — Expand OnlinePlatform dropdown in the UI. Update DemoData with one Hamshack Hotline net entry.
3. **B4-2** — HF seed data (Brian provides frequencies; can be deferred until Brian has the list ready).
4. **B4-4** — Net scheduling form. Requires discussion of where it lives (new view vs. Meetings Lifecycle Track 2).
5. **B4-6** — Net control logging decision (discuss first, then implement if warranted).
6. **B4-5** — Net display / calendar. Last — display is only useful once there's data.
7. **B4-7** — Docs update. Folded into whichever step completes the last code change.

---

## Open questions before coding starts

1. **B4-1 header:** The email from RepeaterBook used `Authorization: Bearer <token>`. The RepeaterBook wiki showed `X-RB-App-Token`. Which header does the live API actually accept? Verify with a test call before building the import function.
2. **B4-4 placement:** Does net scheduling live inside Track 2 (Meetings Lifecycle) or as a standalone view? If Track 2 has landed before this slice starts, fold B4-4 into it.
3. **B4-6 decision:** Net control logging — dedicated flow or Attendance record with Role = "Net Control"? Brian decides.
