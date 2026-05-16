# Design Doc: Slice 5 — ICS 309/214 Export, NTS Practice Message, WinLink Practice Message

**Date:** 2026-05-15
**Revision:** 2026-05-15 — initial draft
**Source:** Design conversation with Brian Darby on 2026-05-15; ICS 309 (FEMA Form 309) and ICS 214 (FEMA Form 214) official field definitions; NTS message format per ARRL NTS Methods and Practices Guidelines; Winlink Express message format; real net scripts in `examples/`.
**Implements PRD FRs:** None directly — new features beyond original PRD scope. Items 10, 11, 12 from the Ham Radio Nets backlog.

**PRD divergences:** None — these features are additive.

**Depends on:** Slice 4 (Sessions row now includes `NCOName`, `NCOLocation`, `RepeaterSystem`; Checkins row includes `Name`; `CheckinsCol` and `SessionsCol` column index objects available; `EndSessionResult` returns `checkinCount`, `uniqueCallsignCount`, `spreadsheetUrl`).

**Does not depend on:** Section-tagged check-ins (deferred to Net Script v2). These exports use session-level and checkin-level data only.

**Defers:**
- Google Drive / Google Docs output for ICS 309/214 (v2 option; requires `https://www.googleapis.com/auth/drive` scope).
- PDF generation of ICS forms.
- Pre-filled downloadable HTML form (print-optimized) — future.
- NTS message relay tracking (who handled the message, relay stations) — future.
- Winlink gateway address configuration per-group — future; hard-coded practice address for v1.
- Sending the Winlink message automatically via a gateway API — out of scope.

---

## Item 10 — ICS 309 / ICS 214 Export

### Why

After the net closes, the NCO is required to file two ICS forms for any session that counts toward served-agency training hours: ICS 309 (Communications Log) and ICS 214 (Activity Log). Today the NCO has to manually copy times and callsigns from the Sheet into a paper or PDF template — error-prone and slow. This feature generates both forms as formatted plain text on the post-net summary screen so the NCO can screenshot the screen or copy the text into a word processor. No new OAuth scopes are needed because nothing is written to Drive. A Google Docs output path is noted as a v2 option.

---

### Scope

**In:**
- New server function `getIcsExport(sessionId)` — reads Sessions and Checkins rows for the session, builds both ICS 309 and ICS 214 payloads, returns them as plain-text strings.
- New TypeScript interfaces: `Ics309Row`, `Ics309Payload`, `Ics214ActivityRow`, `Ics214Payload`, `IcsExportResult`.
- Client: "Export ICS 309 / 214" button on the post-net summary screen (`screen-summary`).
- Client: new `screen-ics` overlay screen — displays both forms as formatted monospace text in `<pre>` blocks; one "Copy ICS 309" and one "Copy ICS 214" button each using `navigator.clipboard.writeText`; "← Back" returns to `screen-summary`.
- Copy fallback: if Clipboard API is unavailable, select-all the `<pre>` block so the NCO can manually copy.

**Out (deferred):**
- Google Drive / Docs output — v2; noted in Open Questions.
- ICS 213 (General Message Form) — separate future item.
- Automated email of the forms to the EC/trustee.
- Section-tagged activity entries (deferred until section tagging ships in Net Script v2).
- PDF generation.

---

### ICS form field definitions

The two forms follow FEMA/NIMS standard definitions. Fields are listed in the order they appear on the official paper forms.

#### ICS 309 — Communications Log

| Field | Source | Notes |
|---|---|---|
| **1. Incident Name** | `session.netType` | Required. "Incident" in ICS terminology; for ARES practice nets this is the net type (e.g. "Washington County ARES Weekly Practice Net"). |
| **2. Operational Period — Date/Time From** | `session.startTimestamp` (formatted) | ISO-8601 UTC → local display string "MM/DD/YYYY HH:mm". |
| **2. Operational Period — Date/Time To** | `session.endTimestamp` (formatted) | Same format. |
| **3. Radio Net Name/ID** | `session.netType` | Duplicate of Incident Name for ARES usage — acceptable. |
| **4. Radio Operator (Prepared By) — Name** | `session.ncoName` | Blank if not set. |
| **4. Radio Operator — ICS Position** | `"Net Control Operator"` | Hard-coded. |
| **4. Radio Operator — Callsign** | `session.ncoCallsign` | |
| **Station Log** (repeating rows) | One row per Checkins entry, sorted by `firstTimestamp` ascending | See sub-fields below. |
| **5. Date/Time** | `checkin.firstTimestamp` | Formatted "HH:mm" local; date shown in header only. |
| **6. From** | `checkin.callsign` | Callsign of the checking-in station. |
| **7. To** | `session.ncoCallsign` | The NCO's callsign (NCS = net control station). |
| **8. Frequency** | Repeater frequency from `session.repeater` or the primary repeater's `Frequency` field | Blank if not determinable. See note below. |
| **9. Mode** | `"FM"` | Hard-coded for v1 (all WashCoARES repeater traffic is FM). |
| **10. Message/Traffic** | `"Check-in"` + `" (×N)"` where N = `checkin.tapCount` if N > 1 | tapCount > 1 indicates the station re-tapped (re-announced); noted as re-check-in. |
| **11. Remarks** | `checkin.name` if set, else blank | The name heard on air. |
| **Prepared By — Name** | `session.ncoName` | Footer line. |
| **Prepared By — Callsign** | `session.ncoCallsign` | |
| **Prepared By — Date/Time** | `session.endTimestamp` formatted | |

**Frequency note:** `session.repeater` (the legacy free-text field, `SessionsCol.Repeater`) stores the free-text repeater value entered when "None / Other" was selected. When a Repeater System was selected at session start (`session.repeaterSystem` is non-blank), the server looks up the system's primary repeater entry from the Repeaters tab and uses its `Frequency` value. If neither is determinable, the Frequency cell is left blank.

**Station Log sort order:** ascending by `checkin.firstTimestamp`. If two rows share the same `firstTimestamp` (unlikely but possible during concurrent taps), secondary sort is by `checkin.callsign` ascending.

#### ICS 214 — Activity Log

The ICS 214 captures who was present and what activities occurred. For a net, each check-in is a "person" and each section of the net is an "activity." Because section tagging is deferred, the Activity Log uses session-level milestones instead.

| Field | Source | Notes |
|---|---|---|
| **1. Incident Name** | `session.netType` | Same as ICS 309. |
| **2. Operational Period — Date/Time From** | `session.startTimestamp` formatted | |
| **2. Operational Period — Date/Time To** | `session.endTimestamp` formatted | |
| **3. Name** | `session.ncoName` | Unit Leader / person preparing the form. |
| **3. ICS Position** | `"Net Control Operator"` | |
| **3. Home Agency** | `"Washington County ARES"` | Hard-coded for v1; configurable in a future Settings slice. |
| **Personnel Roster** (repeating) | One row per unique callsign in Checkins, sorted by callsign ascending | |
| — **Name** | `checkin.name` if set, else blank | |
| — **ICS Position** | `"Net Member"` | Hard-coded. For NCO's own callsign: `"Net Control Operator"`. |
| — **Home Agency** | `"Washington County ARES"` | Hard-coded for v1. |
| **Activity Log** (repeating) | Synthetic rows derived from session timestamps | See sub-fields below. |
| — **Date/Time** | Formatted local timestamp | |
| — **Notable Activities** | Text description | See synthetic activity rows below. |
| **Prepared By — Name** | `session.ncoName` | |
| **Prepared By — Callsign** | `session.ncoCallsign` | |
| **Prepared By — Date/Time** | `session.endTimestamp` formatted | |

**Synthetic activity rows for ICS 214 Activity Log** (v1, no section tagging):

| Row | Date/Time | Notable Activities |
|---|---|---|
| 1 | `session.startTimestamp` | Net opened. NCO: `{ncoCallsign}`. Repeater: `{frequency}` (or "not recorded"). |
| 2 | `session.endTimestamp` | Net closed. `{uniqueCallsignCount}` unique stations checked in. Total check-ins (including re-taps): `{checkinCount}`. Estimated service hours: `{hoursTotal}`. |

When section tagging ships (Net Script v2), each section transition will add an activity row. The `Ics214ActivityRow` interface is designed to accept those rows without structural change.

---

### TypeScript interfaces

```typescript
// A single row in the ICS 309 station log.
export interface Ics309Row {
  dateTime:  string;   // local "HH:mm" — date shown in form header, not per-row
  from:      string;   // callsign of checking-in station
  to:        string;   // NCO callsign
  frequency: string;   // e.g. "145.450 MHz" or blank
  mode:      string;   // "FM" for v1
  message:   string;   // "Check-in" or "Check-in (×2)"
  remarks:   string;   // name if known, else blank
}

// Top-level ICS 309 payload.
export interface Ics309Payload {
  incidentName:    string;
  opPeriodFrom:    string;   // "MM/DD/YYYY HH:mm"
  opPeriodTo:      string;
  radioNetName:    string;
  operatorName:    string;
  operatorPosition:string;
  operatorCallsign:string;
  stationLog:      Ics309Row[];
  preparedByName:  string;
  preparedByCallsign: string;
  preparedByDateTime: string;
}

// A single row in the ICS 214 personnel roster.
export interface Ics214PersonRow {
  name:       string;   // operator name, blank if unknown
  icsPosition:string;   // "Net Control Operator" or "Net Member"
  homeAgency: string;   // "Washington County ARES" for v1
  callsign:   string;   // included as an extra field; not on the paper form but useful
}

// A single row in the ICS 214 activity log.
export interface Ics214ActivityRow {
  dateTime:   string;   // "MM/DD/YYYY HH:mm"
  activity:   string;   // description of the notable activity
}

// Top-level ICS 214 payload.
export interface Ics214Payload {
  incidentName:    string;
  opPeriodFrom:    string;
  opPeriodTo:      string;
  unitLeaderName:  string;
  unitLeaderPosition: string;
  homeAgency:      string;
  personnel:       Ics214PersonRow[];
  activityLog:     Ics214ActivityRow[];
  preparedByName:  string;
  preparedByCallsign: string;
  preparedByDateTime: string;
}

// Combined result returned to the client.
export interface IcsExportPayload {
  ics309Text: string;   // pre-formatted plain text ready for display in <pre>
  ics214Text: string;
  ics309:     Ics309Payload;   // structured data; client uses for display; also available for v2 Docs output
  ics214:     Ics214Payload;
}

export type IcsExportResult =
  | { ok: true;  payload: IcsExportPayload }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_NOT_CLOSED' }   // export only allowed after endSession
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'READ_FAILED' };
```

---

### Server function

#### `getIcsExport(sessionId: string): IcsExportResult` (new)

Read-only; no LockService (no writes). Called after `endSession` completes.

```
1. Validate sessionId: non-empty, ≤ MAX_ID_FIELD.
   → INVALID_INPUT if not.

2. getSpreadsheetOrNull(). → NOT_CONFIGURED if null.

3. Read Sessions tab. Find row where SessionID === sessionId.
   → SESSION_NOT_FOUND if not found.

4. Confirm Status === SESSION_STATUS_CLOSED.
   → SESSION_NOT_CLOSED if still open.
   [Export from an open session is blocked — data is incomplete.]

5. Read Checkins tab. Collect all rows where SessionID === sessionId.
   Sort by FirstTimestamp ascending; secondary sort by Callsign ascending.

6. Resolve repeater frequency:
   a. If session.repeaterSystem is non-blank: read Repeaters tab, find the first
      row matching that SystemName with Type (lowercase) === 'primary' and
      IsActive === true. Use its Frequency value.
   b. Else if session.repeater is non-blank: use session.repeater as the frequency string.
   c. Else: frequency = '' (blank on form).

7. Build Ics309Payload and Ics214Payload from the data collected.

8. Format both payloads as fixed-width plain text (see formatting spec below).

9. Return { ok: true, payload: { ics309Text, ics214Text, ics309, ics214 } }.
```

**6-minute limit:** all operations are single-pass Sheet reads. No HTTP calls. Safe within the Apps Script 6-minute execution limit for sessions with up to ~500 check-in rows.

**Formatting spec for plain-text output:**

ICS 309 plain-text layout:
```
ICS 309 — COMMUNICATIONS LOG
=============================
Incident Name:      {incidentName}
Op Period From:     {opPeriodFrom}
Op Period To:       {opPeriodTo}
Radio Net Name:     {radioNetName}
Operator:           {operatorName} / {operatorCallsign} / {operatorPosition}

TIME   FROM         TO           FREQ           MODE  MESSAGE             REMARKS
------ ------------ ------------ -------------- ----- ------------------- --------------------
HH:mm  KE7XYZ       N7BDD        145.450 MHz    FM    Check-in            Jane Doe
...

Prepared by: {preparedByName} / {preparedByCallsign}   Date/Time: {preparedByDateTime}
```

Column widths: Time 6, From 12, To 12, Freq 14, Mode 5, Message 19, Remarks 20. Strings truncated with `…` if they exceed column width. All text via `textContent` on the client side.

ICS 214 plain-text layout:
```
ICS 214 — ACTIVITY LOG
=======================
Incident Name:      {incidentName}
Op Period From:     {opPeriodFrom}
Op Period To:       {opPeriodTo}
Unit Leader:        {unitLeaderName} / {unitLeaderCallsign} / {unitLeaderPosition}
Home Agency:        {homeAgency}

PERSONNEL ROSTER
CALLSIGN     NAME                     ICS POSITION           HOME AGENCY
------------ ------------------------ ---------------------- -------------------------
KE7XYZ       Jane Doe                 Net Member             Washington County ARES
...

ACTIVITY LOG
DATE/TIME            NOTABLE ACTIVITIES
-------------------- -------------------------------------------------------
MM/DD/YYYY HH:mm     Net opened. NCO: N7BDD. Repeater: 145.450 MHz.
MM/DD/YYYY HH:mm     Net closed. 12 unique stations. 14 total check-ins. 6.0 hrs.

Prepared by: {preparedByName} / {preparedByCallsign}   Date/Time: {preparedByDateTime}
```

---

### Client changes

**`screen-summary` additions:**

Add one button below the existing "Open Sheet" and "Start new net" buttons:

```html
<button id="btn-ics-export" type="button">Export ICS 309 / 214</button>
```

Button is hidden until `endSession` returns `ok: true`. On tap: calls `google.script.run` with `withSuccessHandler` / `withFailureHandler`; shows a brief "Generating…" toast while the call is in flight; on success transitions to `screen-ics`.

**New `screen-ics`:**

```html
<section id="screen-ics" aria-labelledby="ics-title">
  <button id="btn-ics-back" class="secondary" type="button">← Back to Summary</button>
  <h1 id="ics-title">ICS 309 / 214 Export</h1>
  <p class="small">Screenshot this screen or use the Copy buttons below.</p>

  <h2>ICS 309 — Communications Log</h2>
  <button id="btn-copy-309" type="button">Copy ICS 309</button>
  <pre id="ics-309-text" style="overflow-x:auto; font-size:13px; white-space:pre;"></pre>

  <h2>ICS 214 — Activity Log</h2>
  <button id="btn-copy-214" type="button">Copy ICS 214</button>
  <pre id="ics-214-text" style="overflow-x:auto; font-size:13px; white-space:pre;"></pre>
</section>
```

`ALL_SCREENS` array updated to include `'screen-ics'`.

Copy button behavior:
```javascript
function copyPreText(preId, btnId) {
  var text = $(preId).textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      toast('Copied to clipboard.');
    }).catch(function() { selectPreText(preId); });
  } else {
    selectPreText(preId);  // fallback: select all for manual copy
    toast('Text selected — press Ctrl+C or long-press to copy.');
  }
}
function selectPreText(preId) {
  var el = $(preId);
  var range = document.createRange();
  range.selectNodeContents(el);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
```

**`NetControl` state additions:**

```javascript
icsExportPayload: null,   // IcsExportPayload | null — set on successful getIcsExport call
```

The structured `ics309` and `ics214` objects are stored in `icsExportPayload` for potential future use (v2 Docs output) without requiring a second server call.

---

### `ALL_SCREENS` update

Add `'screen-ics'` to the `ALL_SCREENS` array in `index.html`. No other screen flow changes — the ICS screen is only accessible from `screen-summary` via `btn-ics-export`.

---

### Security and constraints

- **No Drive scope required.** All data is read from the existing Spreadsheet. The formatted text is returned to the client in the function return value, not written anywhere.
- **Read-only server path.** No LockService needed.
- **XSS:** `ics309Text` and `ics214Text` are set via `textContent` on `<pre>` elements, not `innerHTML`.
- **SESSION_NOT_CLOSED guard:** export is blocked while the session is open so the form always reflects final data.
- **6-minute limit:** single-pass reads only; safe even for large sessions.
- **v2 note (Google Docs output):** would require adding `https://www.googleapis.com/auth/drive.file` to the Apps Script manifest. The structured payload objects (`ics309`, `ics214`) are already in the return value so the client can pass them to a future `createIcsDocs(payload)` server function without a second Sheet read. Document this in the Open Questions.

---

### Verification criteria

1. After ending a session, the "Export ICS 309 / 214" button appears on `screen-summary`.
2. Tapping the button calls `getIcsExport` and shows "Generating…" toast.
3. On success, the app transitions to `screen-ics`.
4. ICS 309 text contains the correct Incident Name, Op Period dates, operator callsign, and one row per check-in.
5. Check-in rows are sorted by FirstTimestamp ascending.
6. Frequency field: if a Repeater System was selected at session start, shows the primary repeater frequency; if "None / Other" with a free-text repeater, shows that text; if neither, shows blank.
7. `checkin.tapCount > 1` appears as "Check-in (×N)" in the Message column.
8. ICS 214 Personnel Roster contains one row per unique callsign, sorted alphabetically.
9. NCO's own callsign appears with ICS Position "Net Control Operator"; all others show "Net Member".
10. ICS 214 Activity Log has exactly two rows: one at session start, one at session end.
11. "Copy ICS 309" button copies the full pre-formatted text to the clipboard. Toast confirms.
12. Copy fallback: if Clipboard API not available, text is selected.
13. "← Back to Summary" returns to `screen-summary` without losing summary data.
14. Calling `getIcsExport` on an open session returns `SESSION_NOT_CLOSED`.
15. Calling `getIcsExport` with an unknown session ID returns `SESSION_NOT_FOUND`.
16. Session with no check-ins: ICS 309 station log is empty; ICS 214 personnel roster is empty; both forms still render without error.

---

### Open questions

1. **Home Agency hard-coded.** "Washington County ARES" is baked into `Ics214PersonRow.homeAgency`. A future Settings slice could add a `HomeAgency` key/value row so white-label deployments can customize this without a code change. Acceptable for v1.
2. **Mode hard-coded as "FM".** WashCoARES runs all nets on FM repeaters. When HF or digital modes are supported, Mode should come from the Repeater entry or a session-level field. Acceptable for v1.
3. **v2: Google Docs output.** The structured `ics309` and `ics214` objects are already in `IcsExportPayload`. A future `createIcsDocs(payload)` server function can use `DocumentApp.create()` to build properly formatted documents in the NCO's Drive. This requires adding `https://www.googleapis.com/auth/drive.file` to the manifest. Confirm with trustee before implementing — scope addition triggers a re-authorization prompt for all users.
4. **Timezone display.** `FirstTimestamp` and `StartTimestamp` are stored as ISO-8601 UTC strings. The server formats them as local time using `Utilities.formatDate(new Date(isoString), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm')`. Confirm that `Session.getScriptTimeZone()` is set to the correct timezone in the Apps Script project settings (should be `America/Los_Angeles` for WashCoARES).
5. **Column truncation.** The fixed-width plain-text format truncates long strings with `…`. A callsign of 14+ characters in the "From" column (12 chars wide) would be truncated. The `…` marker is sufficient for v1; the structured payload preserves the full string for any downstream use.

---

## Item 11 — NTS Traffic Message (Practice)

### Why

One of the training objectives for ARES weekly nets is handling NTS (National Traffic System) traffic. Today the NCO either reads a pre-written message from a sheet of paper or skips the traffic exercise entirely. This feature generates a properly formatted NTS practice message auto-populated with session details — net name, NCO callsign, date — and displays it on screen during the net so the NCO can read it on air without additional preparation. The NCO can also copy the full message text to share in the net's chat channel or email it to participants after the session.

---

### Scope

**In:**
- New server function `getNtsPracticeMessage(sessionId)` — reads the session row, builds a formatted NTS message, returns it as a structured payload and as plain text.
- New TypeScript interfaces: `NtsMessage`, `NtsMessageResult`.
- Client: "Generate NTS Practice Message" button on the logging screen (`screen-log`) — available during an open session, before End Net.
- Client: new `screen-nts` display screen — shows the full formatted NTS message as plain text; a "Copy Message" button; a "← Back to Net" button that returns to `screen-log` without ending the session.

**Out (deferred):**
- NCO-editable message body text (v2 — would require a form or template system).
- Multiple precedence levels selectable by the NCO (v1 generates ROUTINE only).
- Relay tracking (who handled the message).
- Storing handled messages as rows in a new Messages sheet.
- Scheduled traffic (pre-written messages loaded from the Sheet).
- ARL-coded messages (ARL check expansion) — future; v1 uses a plain text body without ARL coding.

---

### NTS message field definitions

The NTS message format is defined by the ARRL NTS Methods and Practices Guidelines. A standard NTS message has six groups, in this order, read on air with the word "NTS" or "Traffic" at the start.

| Group | Field | Value for this feature | NTS term |
|---|---|---|---|
| 1 | **Precedence** | `ROUTINE` | Hard-coded for all practice messages. |
| 1 | **Handling Instructions** | Blank for v1 (no ARL code) | Optional; "HXG" (cancel if not delivered within X days) is the most common. |
| 1 | **Message Number** | Sequential integer, session-scoped: `{sessionId-short}-001` | `{sessionId-short}` = first 6 chars of SessionID. Unique enough for a practice net. |
| 1 | **Station of Origin** | `session.ncoCallsign` | The originating station's callsign. |
| 1 | **ARL Check** | Word count of the message text (integer) | "Check" in NTS terminology = word count of the text group only. |
| 1 | **Place of Origin** | `session.ncoLocation` if set, else `session.ncoCallsign` | City or place where message originated. |
| 1 | **Date Filed** | Net date in NTS format: `{month-abbrev} {day}` (e.g. "MAY 15") | |
| 1 | **Time Filed** | `session.startTime` in 24h format (e.g. "1900") | |
| 2 | **Addressee — Name** | `"NET PARTICIPANTS"` | Hard-coded practice addressee. |
| 2 | **Addressee — Address** | `"WASHINGTON COUNTY ARES NET"` | Hard-coded. |
| 2 | **Addressee — City/State/Zip** | `"HILLSBORO OR 97123"` | Hard-coded for WashCoARES; see Open Questions. |
| 2 | **Addressee — Phone** | Blank | Not used for practice nets. |
| 3 | **Message Text** | See template below | 15–25 words recommended; see template. |
| 4 | **Signature** | `session.ncoName` if set, else `session.ncoCallsign` | |

**Message text template** (auto-generated, not editable in v1):

```
THIS IS A PRACTICE MESSAGE FROM THE {netType} ON {dateFormatted}. NET CONTROL IS {ncoCallsign} LOCATED IN {ncoLocation}. PLEASE ACKNOWLEDGE RECEIPT. END.
```

- `{netType}`: `session.netType`, uppercased.
- `{dateFormatted}`: e.g. "15 MAY 2026".
- `{ncoCallsign}`: `session.ncoCallsign`, uppercased.
- `{ncoLocation}`: `session.ncoLocation` if set, else "QTH".
- "END" is the NTS message end marker and is not counted in the ARL check word count.

Word count (ARL check): count space-delimited tokens in the message text, excluding the trailing "END." marker. The server computes this.

**On-air format** (how the NCO reads the message aloud):

```
NTS TRAFFIC FOLLOWS — ONE MESSAGE

ROUTINE  (pause)  NO HANDLING INSTRUCTIONS

NUMBER {messageNumber}  (pause)  {stationOfOrigin}  (pause)  CHECK {wordCount}
{placeOfOrigin}  (pause)  {dateFiled}  (pause)  {timeFiled}

TO: {addresseeName}
    {addresseeAddress}
    {addresseeCity}

MESSAGE: {messageText}

SIGNED: {signature}

END OF TRAFFIC
```

The NCO reads each group clearly, pausing at the markers. The `screen-nts` display is formatted to match this on-air reading order so the NCO can read directly off the screen.

---

### TypeScript interfaces

```typescript
export interface NtsMessage {
  precedence:          string;   // "ROUTINE"
  handlingInstructions:string;   // blank for v1
  messageNumber:       string;   // e.g. "abc123-001"
  stationOfOrigin:     string;   // NCO callsign
  arlCheck:            number;   // word count of messageText (excluding "END")
  placeOfOrigin:       string;
  dateFiled:           string;   // "MAY 15"
  timeFiled:           string;   // "1900"
  addresseeName:       string;
  addresseeAddress:    string;
  addresseeCity:       string;
  addresseePhone:      string;   // blank
  messageText:         string;   // plain text, 15–25 words recommended
  signature:           string;
  // Pre-formatted on-air reading text — ready for display in <pre>.
  formattedText:       string;
}

export type NtsMessageResult =
  | { ok: true;  message: NtsMessage }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_CLOSED' }   // message is only shown during an open session
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'NOT_CONFIGURED' };
```

---

### Server function

#### `getNtsPracticeMessage(sessionId: string): NtsMessageResult` (new)

Read-only; no LockService.

```
1. Validate sessionId: non-empty, ≤ MAX_ID_FIELD. → INVALID_INPUT if not.

2. getSpreadsheetOrNull(). → NOT_CONFIGURED if null.

3. Read Sessions tab. Find row where SessionID === sessionId.
   → SESSION_NOT_FOUND if not found.

4. Confirm Status === SESSION_STATUS_OPEN.
   → SESSION_CLOSED if already closed.
   [NTS message is shown during the net, not after it closes.]

5. Extract session fields:
   ncoCallsign   = row[SessionsCol.NCOCallsign]
   ncoName       = row[SessionsCol.NCOName]       (may be blank)
   ncoLocation   = row[SessionsCol.NCOLocation]   (may be blank)
   netType       = row[SessionsCol.NetType]
   netDate       = row[SessionsCol.NetDate]        ("YYYY-MM-DD")
   netTime       = row[SessionsCol.NetTime]        ("HH:mm")

6. Build fields:
   messageNumber = sessionId.slice(0, 6).toLowerCase() + '-001'
   stationOfOrigin = ncoCallsign.toUpperCase()
   placeOfOrigin   = ncoLocation.trim() || ncoCallsign.toUpperCase()
   signature       = ncoName.trim()     || ncoCallsign.toUpperCase()
   dateParts = netDate.split('-') → [year, month, day]
   MONTH_ABBREVS = ['JAN','FEB','MAR','APR','MAY','JUN',
                    'JUL','AUG','SEP','OCT','NOV','DEC']
   dateFiled = MONTH_ABBREVS[parseInt(month) - 1] + ' ' + parseInt(day)
   dateFormatted = parseInt(day) + ' ' + MONTH_ABBREVS[...] + ' ' + year
   timeFiled = netTime.replace(':', '')   // "19:00" → "1900"

7. Build messageText:
   template = 'THIS IS A PRACTICE MESSAGE FROM THE {netType} ON {dateFormatted}. ' +
              'NET CONTROL IS {ncoCallsign} LOCATED IN {ncoLocation}. ' +
              'PLEASE ACKNOWLEDGE RECEIPT. END.'
   ncoLocationUpper = ncoLocation.trim().toUpperCase() || 'QTH'
   Substitute all placeholders.

8. arlCheck = count space-delimited tokens in messageText,
   EXCLUDING the trailing 'END.' token.
   (Trim, split on /\s+/, filter out the terminal 'END.' entry.)

9. Build NtsMessage object.

10. Build formattedText (the on-air reading order string).

11. Return { ok: true, message }.
```

---

### Client changes

**`screen-log` addition:**

Add a button below the "End Net" button:

```html
<button id="btn-nts-message" class="secondary" type="button">NTS Practice Message</button>
```

The button is shown only while a session is open. On tap: calls `google.script.run` → `getNtsPracticeMessage(sessionId)`; shows "Generating…" toast while in flight; on success transitions to `screen-nts`.

**New `screen-nts`:**

```html
<section id="screen-nts" aria-labelledby="nts-title">
  <button id="btn-nts-back" class="secondary" type="button">← Back to Net</button>
  <h1 id="nts-title">NTS Practice Message</h1>
  <p class="small">Read this message on air. Tap Copy to share with participants.</p>
  <button id="btn-copy-nts" type="button">Copy Message</button>
  <pre id="nts-message-text"
       style="overflow-x:auto; font-size:15px; white-space:pre; line-height:1.6;"></pre>
</section>
```

`ALL_SCREENS` updated to include `'screen-nts'`.

"← Back to Net" returns to `screen-log` without calling `endSession`. The session remains open. The NCO can return to the NTS message screen by tapping "NTS Practice Message" again — `getNtsPracticeMessage` is idempotent and cheap (single row read).

**`NetControl` state addition:**

```javascript
ntsMessage: null,   // NtsMessage | null — populated on successful getNtsPracticeMessage call
```

---

### Security and constraints

- **No writes.** `getNtsPracticeMessage` is read-only. No LockService.
- **SESSION_CLOSED guard.** The message is only generated for open sessions. It would be confusing to display a "live" NTS message for a closed session on the summary screen; use `getIcsExport` for post-net archival instead.
- **XSS.** `formattedText` is set via `textContent` on the `<pre>` element.
- **Word count (ARL Check).** Computed server-side from the generated `messageText`. The client displays the value from `message.arlCheck` — it does not re-count client-side.
- **No NTS registry.** This is a practice message. It is not filed with any NTS bureau or relay net. The message number is session-scoped only. No message routing data is written anywhere.

---

### Verification criteria

1. "NTS Practice Message" button is visible on `screen-log` during an open session.
2. Button tap calls `getNtsPracticeMessage` and shows "Generating…" toast.
3. `screen-nts` displays the full formatted on-air reading script.
4. Message Number begins with the first 6 chars of the SessionID.
5. ARL Check equals the word count of the message body text, excluding "END."
6. Date Filed is formatted as "MAY 15" (month abbreviation, day with no leading zero).
7. Time Filed is "1900" format (no colon).
8. If NCO Name was set at session start, Signature shows the name; otherwise shows the callsign.
9. If NCO Location was set, Place of Origin and the message body show the location; otherwise "QTH".
10. "Copy Message" copies `formattedText` to clipboard. Toast confirms.
11. "← Back to Net" returns to `screen-log`; session state is unchanged (check-in list intact).
12. Tapping "NTS Practice Message" a second time regenerates the message (same content; new server call is harmless).
13. Calling `getNtsPracticeMessage` on a closed session returns `SESSION_CLOSED`.
14. Message text is 15–25 words (verify generated template against this range).

---

### Open questions

1. **Addressee city/state/zip hard-coded.** "HILLSBORO OR 97123" is hard-coded for WashCoARES. A future Settings slice could add a `NtsAddresseeCity` key. Acceptable for v1.
2. **Single precedence level.** Only ROUTINE is generated. An NCO might want to demonstrate WELFARE or PRIORITY for training purposes. A future version could let the NCO select the precedence from a dropdown on `screen-nts` before reading. For v1 ROUTINE is correct for all practice contexts.
3. **ARL-coded messages.** The ARRL publishes a catalog of ARL-numbered practice messages (ARL FIFTY-FIVE, etc.) that are commonly used in NTS training. Supporting those would require a lookup table and ARL check expansion logic. Deferred — the plain text body is sufficient for basic training.
4. **Handling Instructions.** `HXG` (cancel if not delivered in X days) is the most common HI for practice messages. Add it to the message in v2 once the NCO can set an expiry window.
5. **Message body editability.** Some NCOs prefer to personalize the practice message. A text field on `screen-nts` to edit the body before copying would be a meaningful v2 improvement. Word count would need to recompute client-side on edit.

---

## Item 12 — WinLink Practice Message

### Why

Winlink (also called Winlink Express or Winlink 2000) is a radio email system widely used in ARES emergency communications. Practicing Winlink sends during a net is a common training activity — participants open Winlink Express, compose a short message, and send it via RF to a local gateway. Today the NCO has to verbally dictate a Winlink message or write one on a whiteboard. This feature generates a complete Winlink-formatted practice message on screen so the NCO can read it on air and participants can copy it directly into their Winlink Express compose window.

---

### Scope

**In:**
- New server function `getWinlinkPracticeMessage(sessionId)` — reads the session row, builds a formatted Winlink message, returns it as a structured payload and plain text.
- New TypeScript interfaces: `WinlinkMessage`, `WinlinkMessageResult`.
- Client: "WinLink Practice Message" button on `screen-log` — shown during an open session.
- Client: new `screen-winlink` display screen — shows the formatted Winlink message; "Copy Message" button; "← Back to Net" button.

**Out (deferred):**
- Per-group configurable Winlink gateway address (v2; Settings slice).
- Winlink gateway API integration (out of scope — Winlink RF operation is performed by the participant on their own radio).
- Storing sent/acknowledged Winlink messages as session records.
- SHARES / PACTOR / VARA gateway selection — future; display only for v1.
- Reply tracking (who confirmed receipt).

---

### Winlink message field definitions

A Winlink message as composed in Winlink Express has the following header fields plus a body. The format below matches what participants type into the Winlink Express compose window. The "P2P" (Peer-to-Peer) send mode is the most common for in-net training because it does not require internet-connected gateways.

| Field | Value for this feature | Notes |
|---|---|---|
| **To** | `W6BA@winlink.org` | Hard-coded WinLink practice address for v1. W6BA is a well-known Winlink system callsign used for test/practice messages. See Open Questions re: gateway address configurability. |
| **Cc** | Blank | Not used for basic practice. |
| **From** | `{ncoCallsign}@winlink.org` | NCO's Winlink address. Participants sending replies use their own `{callsign}@winlink.org`. |
| **Subject** | `Practice — {netType} — {netDate}` | e.g. "Practice — Washington County ARES Weekly — 2026-05-15". |
| **Date** | Net date + time in RFC 2822-like format: `{day} {month-abbrev} {year} {time} -0700` | Used for display only; Winlink Express sets its own date/time on send. Shown to help participants fill in the compose window correctly. |
| **Message Body** | See template below | Plain text, no HTML. |

**Message body template:**

```
This is a Winlink practice message from the {netType}.

Net date: {netDate}
Net control: {ncoCallsign} ({ncoLocation})

Please reply to this message to confirm receipt. Include your callsign and location in the reply.

This message was generated by the {netType} Net Control station. No operational significance.

73 de {ncoCallsign}
```

- `{netType}`: `session.netType` (display case, not uppercased — this is an email body, not a phone patch message).
- `{netDate}`: formatted as "15 May 2026".
- `{ncoCallsign}`: `session.ncoCallsign`.
- `{ncoLocation}`: `session.ncoLocation` if set, else "QTH unknown".

**On-screen display format** (what participants copy into Winlink Express):

```
WINLINK PRACTICE MESSAGE
========================
To:      W6BA@winlink.org
From:    {ncoCallsign}@winlink.org
Subject: Practice — {netType} — {netDate}
Date:    {day} {month-abbrev} {year} {time} -0700

--- MESSAGE BODY ---
{messageBody}
--- END ---

To send this message:
  1. Open Winlink Express.
  2. Compose a new message.
  3. Set the To address to: W6BA@winlink.org
  4. Copy the Subject and Body above.
  5. Send via your preferred Winlink gateway.
```

The display includes the step-by-step instructions so less-experienced participants can follow along without prior Winlink training.

---

### TypeScript interfaces

```typescript
export interface WinlinkMessage {
  to:          string;   // "W6BA@winlink.org"
  cc:          string;   // blank
  from:        string;   // "{ncoCallsign}@winlink.org"
  subject:     string;
  date:        string;   // display-only date string
  body:        string;   // plain text body
  // Pre-formatted display text — ready for <pre>; includes step-by-step instructions.
  formattedText: string;
}

export type WinlinkMessageResult =
  | { ok: true;  message: WinlinkMessage }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_CLOSED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'NOT_CONFIGURED' };
```

---

### Server function

#### `getWinlinkPracticeMessage(sessionId: string): WinlinkMessageResult` (new)

Read-only; no LockService.

```
1. Validate sessionId: non-empty, ≤ MAX_ID_FIELD. → INVALID_INPUT if not.

2. getSpreadsheetOrNull(). → NOT_CONFIGURED if null.

3. Read Sessions tab. Find row where SessionID === sessionId.
   → SESSION_NOT_FOUND if not found.

4. Confirm Status === SESSION_STATUS_OPEN.
   → SESSION_CLOSED if already closed.

5. Extract session fields:
   ncoCallsign = row[SessionsCol.NCOCallsign]
   ncoLocation = row[SessionsCol.NCOLocation]  (may be blank)
   netType     = row[SessionsCol.NetType]
   netDate     = row[SessionsCol.NetDate]       ("YYYY-MM-DD")
   netTime     = row[SessionsCol.NetTime]       ("HH:mm")

6. Build fields:
   dateParts = netDate.split('-') → [year, month, day]
   MONTH_ABBREVS = ['Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec']
   MONTH_ABBREVS_UPPER = ['JAN','FEB',...]
   monthAbbrev = MONTH_ABBREVS[parseInt(month) - 1]
   dayInt = parseInt(day)
   dateFormatted = dayInt + ' ' + monthAbbrev + ' ' + year     // "15 May 2026"
   rfcDate = dayInt + ' ' + monthAbbrev + ' ' + year + ' ' + netTime + ' -0700'
   ncoLocationDisplay = ncoLocation.trim() || 'QTH unknown'

7. to      = 'W6BA@winlink.org'
   from    = ncoCallsign.toUpperCase() + '@winlink.org'
   subject = 'Practice — ' + netType + ' — ' + netDate

8. Build body using the template (plain text substitution).

9. Build formattedText (header block + instructions).

10. Return { ok: true, message }.
```

---

### Client changes

**`screen-log` addition:**

Add a second button below "NTS Practice Message":

```html
<button id="btn-winlink-message" class="secondary" type="button">WinLink Practice Message</button>
```

Shown only while a session is open. On tap: calls `google.script.run` → `getWinlinkPracticeMessage(sessionId)`; shows "Generating…" toast while in flight; on success transitions to `screen-winlink`.

**New `screen-winlink`:**

```html
<section id="screen-winlink" aria-labelledby="winlink-title">
  <button id="btn-winlink-back" class="secondary" type="button">← Back to Net</button>
  <h1 id="winlink-title">WinLink Practice Message</h1>
  <p class="small">Share this on air. Participants copy the fields into Winlink Express.</p>
  <button id="btn-copy-winlink" type="button">Copy Message</button>
  <pre id="winlink-message-text"
       style="overflow-x:auto; font-size:15px; white-space:pre; line-height:1.6;"></pre>
</section>
```

`ALL_SCREENS` updated to include `'screen-winlink'`.

"← Back to Net" returns to `screen-log`; session remains open.

**`NetControl` state addition:**

```javascript
winlinkMessage: null,   // WinlinkMessage | null
```

**Copy button:** same `copyPreText` helper used for ICS 309/214 export (defined in Item 10). No new copy logic needed.

---

### Security and constraints

- **No writes.** `getWinlinkPracticeMessage` is read-only.
- **No actual message transmission.** The server generates display text only. No Winlink API is called. No `UrlFetchApp` calls.
- **XSS.** `formattedText` set via `textContent` on `<pre>`.
- **SESSION_CLOSED guard.** Same as NTS message — only generated for open sessions.
- **Callsign in email address.** `{callsign}@winlink.org` is a well-known Winlink addressing convention and is safe to display. It is not a Google email address.
- **Hard-coded gateway.** W6BA@winlink.org is a real Winlink system account used for testing. It is publicly documented and safe to use in practice messages.

---

### Verification criteria

1. "WinLink Practice Message" button is visible on `screen-log` during an open session.
2. Button tap calls `getWinlinkPracticeMessage` and shows "Generating…" toast.
3. `screen-winlink` displays the formatted message with correct To, From, Subject, Date, and body.
4. From field is `{ncoCallsign}@winlink.org` (callsign uppercased).
5. Subject contains the net type and net date in YYYY-MM-DD format.
6. Message body contains net type (display case), formatted date ("15 May 2026"), NCO callsign, and NCO location (or "QTH unknown").
7. Step-by-step Winlink instructions appear below the message header.
8. "Copy Message" copies `formattedText` to clipboard. Toast confirms.
9. "← Back to Net" returns to `screen-log`; session state is unchanged.
10. Tapping "WinLink Practice Message" again regenerates the message (idempotent).
11. Calling `getWinlinkPracticeMessage` on a closed session returns `SESSION_CLOSED`.
12. If NCO Location was blank at session start, body shows "QTH unknown".

---

### Open questions

1. **Gateway address configurability.** W6BA@winlink.org is hard-coded. Other ARES groups (white-label deployments) may have a preferred local gateway or a group-specific Winlink address. A `WinlinkGateway` key in the Settings tab would make this configurable without code changes. Acceptable hard-coded for v1.
2. **Timezone offset hard-coded as `-0700`.** Pacific Daylight Time. During Pacific Standard Time (November–March) this is incorrect (should be `-0800`). The `date` field on the Winlink form is for participant reference only — Winlink Express sets its own timestamp on send — so this inaccuracy has no operational effect. A future fix: use `Utilities.formatDate(new Date(netDate), 'America/Los_Angeles', 'Z')` to get the correct offset. Acceptable for v1.
3. **P2P vs. gateway send.** The step-by-step instructions describe sending to W6BA via a Winlink gateway. Some groups practice P2P (peer-to-peer) Winlink sends, where two stations connect directly on RF. P2P requires specifying a destination callsign (not a @winlink.org address). A future version could offer a P2P mode with a selectable destination callsign. Deferred.
4. **Reply tracking.** Knowing which participants successfully sent a Winlink reply to the practice message would be valuable training data. The Winlink system provides a web-based message log at winlink.org. Integration is out of scope; a future feature could poll the Winlink API to check for replies after the net ends.
5. **Shared copy helper.** Items 10, 11, and 12 all use the same `copyPreText` / `selectPreText` client-side helper functions. These functions are defined once (in Item 10) and reused in Items 11 and 12. Confirm this shared dependency is noted in the implementation task for whichever item is implemented first.

---

## Shared implementation notes (Items 10, 11, 12)

These three items can be implemented independently in any order, with one shared dependency:

**`copyPreText` / `selectPreText` helper functions** — defined once in `index.html` when the first of the three items is implemented. The second and third items reference the same functions. The implementation checklist for each item beyond the first must note "requires copyPreText already defined."

**`ALL_SCREENS` array** — currently contains 7 entries. After all three items are implemented it will contain 10 entries:
```javascript
var ALL_SCREENS = [
  'screen-start', 'screen-preamble', 'screen-log', 'screen-credits',
  'screen-end', 'screen-summary', 'screen-editor',
  'screen-ics',     // Item 10
  'screen-nts',     // Item 11
  'screen-winlink', // Item 12
];
```

**Server function naming convention:** `getIcsExport`, `getNtsPracticeMessage`, `getWinlinkPracticeMessage` — all read-only, all follow the existing `get*` naming pattern established in Slices 1–4.

**No new Sheet tabs.** None of the three items requires a new spreadsheet tab. All data is read from existing Sessions, Checkins, and Repeaters tabs.

**No new Script Properties.** Hard-coded values (Home Agency, Winlink gateway address, NTS addressee) are adequate for v1. The Settings tab (created in Slice 4's `setupSheets`) is the intended home for making these configurable without code changes, but that is deferred to a future Settings UI slice.

---

## Change log

| Date | Round | Summary |
|---|---|---|
| 2026-05-15 | 0 | Initial draft — Items 10, 11, 12 |
