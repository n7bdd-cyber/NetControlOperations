# Design Doc: Slice 4 — Net Script v1 (Templates, Teleprompter, Section Advance)

**Date:** 2026-05-14
**Revision:** 2026-05-14 — round 2 (second bee review + Brian decisions)
**Source:** Design conversation with Brian Darby on 2026-05-14; two three-goldfish reviews; real net scripts in `docs/`
**Implements PRD FRs:** None directly — new feature beyond the original PRD scope. Feeds into FR-1 (session metadata) via NCOName/NCOLocation additions.

**PRD divergences:** None — this feature is additive.

**Depends on:** Slice 3 (Others tab, Settings tab placeholder, recognition checkbox, FCC ID timer already in client from Slice 3).

**Real net scripts reviewed:**
- `docs/SCRIPT FOR THE WASHINGTON COUNTY ARES NET.md` — primary/alternate repeater system; suffix-group sections; per-repeater closing credits
- `docs/Clackamas County Net Preamble.md` — EchoLink section; county + suffix-letter sections; NCO instruction blocks
- `docs/OREGON EMERGENCY NET PREAMBLE.md` — HF net; suffix and geographic breaks
- `docs/Script for Checking in a Small Number of Stations.md` — simplex/tactical subnet

**Defers:**
- Section-tagged check-ins (sectionName column on Checkins) — Net Script v2.
- Per-section recognition batches and coverage analysis — Net Script v2.
- Teleprompter auto-scroll — future UX polish.
- TTS callsign read-back — future, off by default.
- ICS 309/214 export — separate slice.
- Template version history (full audit log) — future; this slice stores last-editor only.
- Live template sync during a session — future; this slice uses client snapshot.
- Repeaters editor UI — deferred; Repeaters tab edited directly in the Sheet at v0.
- Link type name finalization — Brian will update EchoLink/AllStar/IRLP/etc. display names; schema accepts free-text type strings.

---

## Why

The NCO doesn't just log callsigns — they run a structured session: preamble on air, sections called in sequence, recognition of each station, credits at the close. Today all of that lives on a laminated card or in the NCO's memory. Slice 4 puts the script on the phone screen so the NCO has the exact phrasing in front of them, with fill-in variables substituted automatically, and advances section by section without hunting for their place. It also captures the repeater system in use each session so preambles and closing credits resolve correctly regardless of which repeater the net runs on that night.

---

## Scope

**In:**
- New `Templates` Sheet tab; seeded with one default template on first run.
- Updated `Repeaters` tab: two new columns (`Description`, `ClosingCredit`); link entries (EchoLink, AllStar, etc.) as rows with blank Frequency/PlTone and a free-text Type.
- `getTemplates()` server function — returns all non-deleted templates.
- `getRepeaterSystems()` server function — returns all active systems grouped into primary/linked/alternate/links arrays.
- `saveTemplate(input)` server function — upsert; AdminEmails gate; Google-email attribution.
- `deleteTemplate(templateId)` server function — soft delete; AdminEmails gate.
- `SESSIONS_HEADERS` and `StartSessionInput` extended with `NCOName`, `NCOLocation`, `RepeaterSystem`.
- Client: session-start form — Name, Location, Repeater System dropdown, Tonight's Repeater sub-picker, Net Script dropdown.
- Client: fill-in variable substitution at session start.
- Client: script panel — Preamble → Sections → Credits three-phase flow.
- Client: section advance (hold-to-advance 1.5 s; amber soft-gate).
- Client: section progress indicator.
- Client: template editor (AdminEmails only).
- Client: "No Script" mode — skip directly to logging view.

**Out (deferred):**
- Section-tagged check-ins on Checkins rows.
- Per-section recognition batch.
- Teleprompter auto-scroll.
- Drag-to-reorder sections in editor.
- Template version history beyond last-editor.
- Live version-check during session.
- ICS 309/214 export.
- Repeaters editor UI.

---

## Sheet schema changes

### `Templates` tab (new)

Created by `setupSheets`. Header frozen. Soft-deleted rows retained for historical integrity.

| # | Column | Type | Notes |
|---|---|---|---|
| 0 | `TemplateId` | string | UUID **client-generated** on create; used as stable row key |
| 1 | `Name` | string | Display name |
| 2 | `Preamble` | string | Full preamble text with `{{variable}}` placeholders |
| 3 | `SectionsJson` | string | JSON array of `TemplateSection` objects |
| 4 | `Credits` | string | Closing text with `{{variable}}` placeholders |
| 5 | `IsDefault` | boolean | Exactly one non-deleted template is default |
| 6 | `CreatedAt` | ISO-8601 UTC | Set server-side on create; client-supplied value ignored |
| 7 | `UpdatedAt` | ISO-8601 UTC | Updated on every save |
| 8 | `UpdatedBy` | string | Google email of the last editor (available from `Session.getActiveUser()`) |
| 9 | `DeletedAt` | ISO-8601 UTC | Blank = active; non-blank = soft-deleted |

`UpdatedBy` stores the editor's Google email directly. Attribution in a Google-authenticated system naturally uses email — a callsign is a radio identifier, not a contact method. The Templates tab should be restricted in Sheet sharing to AdminEmails users so this email is not exposed to non-admins.

```typescript
export const TEMPLATES_HEADERS = [
  'TemplateId','Name','Preamble','SectionsJson','Credits',
  'IsDefault','CreatedAt','UpdatedAt','UpdatedBy','DeletedAt',
] as const;
export const SHEET_TEMPLATES = 'Templates';

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
```

---

### `Repeaters` tab (updated — two new columns appended)

One row per repeater or per link entry. All rows sharing a `SystemName` form one logical system. `DisplayOrder` values must be unique within a system.

| # | Column | Type | Notes |
|---|---|---|---|
| 0 | `SystemName` | string | Logical group, e.g. "WashCoARES" |
| 1 | `RepeaterName` | string | Callsign, site name, or link node ID (e.g. "K7RPT-L") |
| 2 | `Frequency` | string | e.g. "145.450 MHz"; blank for link entries |
| 3 | `PlTone` | string | e.g. "107.2 Hz"; blank if none or if link entry |
| 4 | `Type` | string | `'primary'` \| `'linked'` \| `'alternate'` \| free-text link type |
| 5 | `DisplayOrder` | number | Sort order within system; 1-based; **unique within system** |
| 6 | `IsActive` | boolean | FALSE = omitted from session-start dropdown |
| 7 | `Description` | string | **(NEW)** Owner/club name for primary/alternate; site/location for linked; connection description for links |
| 8 | `ClosingCredit` | string | **(NEW)** Per-row closing credit text → `{{repeaterCredit}}`; blank for linked/link entries |

**Type semantics:**
- `'primary'` — designated main frequency for a single-at-a-time system (e.g. WashCoARES 145.450).
- `'linked'` — part of a simultaneously-active linked repeater network (e.g. Oregon ARES D1's five repeaters). All linked rows are active for every session; no per-session selection.
- `'alternate'` — fallback when primary/linked network is unavailable.
- **Free-text** — link entry (EchoLink, AllStar, IRLP, etc.). Any string that does not case-insensitively match `'primary'`, `'linked'`, or `'alternate'` is treated as a link type.

**Type classification** (server-side, case-insensitive): `type.toLowerCase()` is compared against `'primary'`, `'linked'`, `'alternate'`. The raw stored string is preserved for display in `{{links}}` output.

```typescript
export const REPEATERS_HEADERS = [
  'SystemName','RepeaterName','Frequency','PlTone','Type',
  'DisplayOrder','IsActive','Description','ClosingCredit',
] as const;
export const SHEET_REPEATERS = 'Repeaters';

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

export interface RepeaterEntry {
  systemName:    string;
  repeaterName:  string;
  frequency:     string;
  plTone:        string;
  type:          string;   // raw value as stored; normalized only for classification
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
```

**Seeded default rows** (only when tab is newly created — `created === true`):

*WashCoARES — based on the real net script:*

| SystemName | RepeaterName | Frequency | PlTone | Type | DisplayOrder | IsActive | Description | ClosingCredit |
|---|---|---|---|---|---|---|---|---|
| WashCoARES | WORC | 145.450 MHz | 107.2 Hz | primary | 1 | TRUE | Western Oregon Radio Club, Inc. | We thank the Western Oregon Radio Club, Inc. for the use of the 145.450 MHz repeater. |
| WashCoARES | Wes Allen | 440.350 MHz | 127.3 Hz | alternate | 2 | TRUE | Family of Wes Allen, silent key | We thank the family of Wes Allen, silent key, for the use of the 440.350 MHz repeater. |
| WashCoARES | WCARC | 147.360 MHz | | alternate | 3 | TRUE | Washington County Amateur Radio Corporation | We thank the Washington County Amateur Radio Corporation for the use of the 147.360 MHz repeater. |

*Oregon ARES D1 — placeholder rows; all IsActive = FALSE until trustee fills RepeaterName and verifies details:*

| SystemName | RepeaterName | Frequency | PlTone | Type | DisplayOrder | IsActive | Description | ClosingCredit |
|---|---|---|---|---|---|---|---|---|
| Oregon ARES D1 | (trustee fills) | 147.320 MHz | 100.0 Hz | linked | 1 | FALSE | | |
| Oregon ARES D1 | (trustee fills) | 442.325 MHz | 100.0 Hz | linked | 2 | FALSE | | |
| Oregon ARES D1 | (trustee fills) | 444.400 MHz | 100.0 Hz | linked | 3 | FALSE | | |
| Oregon ARES D1 | (trustee fills) | 147.040 MHz | 100.0 Hz | linked | 4 | FALSE | | |
| Oregon ARES D1 | (trustee fills) | 146.720 MHz | 114.8 Hz | linked | 5 | FALSE | Wikiup Mountain | |
| Oregon ARES D1 | (trustee fills) | 146.840 MHz | | alternate | 6 | FALSE | | |
| Oregon ARES D1 | K7RPT-L | | | EchoLink | 7 | FALSE | K7RPT-L repeater connection | |

---

### `Sessions` tab (updated)

Three columns appended at indices 12–14 (safe migration — existing rows get empty strings):

| # | Column | Notes |
|---|---|---|
| 12 | `NCOName` | NCO's preferred name |
| 13 | `NCOLocation` | NCO's location at time of net |
| 14 | `RepeaterSystem` | SystemName of the selected repeater system |

```typescript
export const SessionsCol = {
  // ...existing 0–11...
  NCOName:        12,
  NCOLocation:    13,
  RepeaterSystem: 14,
} as const;

// New max constants:
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
```

`setupSheets` header migration: check `headerRow.length < 15`; if so, call `sheet.getRange(1, 13, 1, 3).setValues([['NCOName', 'NCOLocation', 'RepeaterSystem']])` then re-freeze row 1. Existing data rows are not touched — `row[12]`, `row[13]`, `row[14]` return `''` for old rows, which is safe.

`SetupSheetsResult.created` updated union:
```typescript
created: Array<'Sessions' | 'Checkins' | 'Roster' | 'Others' | 'Templates' | 'Repeaters'>;
```

---

## TypeScript interfaces

```typescript
export interface TemplateSection {
  id:        string;   // UUID client-generated; must be unique within the template
  title:     string;
  callToAir: string;   // text read on air; {{variables}} substituted at session start
  notes:     string;   // NCO-only instruction; shown on screen in muted style; NOT substituted; NOT read on air
  order:     number;   // 1-based; must be unique within the template
}

export interface NetTemplate {
  templateId:         string;
  name:               string;
  preamble:           string;
  sections:           TemplateSection[];
  credits:            string;
  isDefault:          boolean;
  createdAt:          string;
  updatedAt:          string;
  updatedBy:          string;   // Google email of last editor
  deletedAt:          string;   // blank = active
  sectionsParseError?: boolean; // true when SectionsJson cell contained malformed JSON
}

// Null when "No Script" is selected.
export type ActiveScript = {
  template:            NetTemplate;
  currentPhase:        'preamble' | 'section' | 'credits';
  currentSectionIndex: number;   // 0-based into template.sections[]
  substitutedPreamble: string;
  substitutedCredits:  string;
  // substituteVariables applied to callToAir only; notes passed through raw.
  substitutedSections: Array<TemplateSection & { substitutedCallToAir: string }>;
} | null;

export interface SaveTemplateInput {
  template: NetTemplate;   // templateId client-generated UUID; server uses it as-is
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

export interface StartSessionInput {
  requestId:        string;
  date:             string;
  time:             string;
  netType:          string;
  ncoCallsign:      string;
  repeater?:        string;
  purposeNotes?:    string;
  ncoName?:         string;         // NEW
  ncoLocation?:     string;         // NEW
  repeaterSystem?:  string;         // NEW — SystemName of selected system
}
```

---

## Fill-in variables

Substituted **client-side at session start** via:

```typescript
function substituteVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
```

Applied to: `preamble`, each section's `callToAir`, `credits`.
**Not applied to:** section `notes` — passed through raw so NCO instructions are shown as-written.
Unknown variable names are left as `{{variableName}}` so the NCO can see and report a template error.
All substituted strings reach the DOM via `textContent` only — never `innerHTML`.

### Session variables

| Variable | Value | Example |
|---|---|---|
| `{{date}}` | Full weekday, full month, day, year | "Tuesday, May 14, 2026" |
| `{{ncoCallsign}}` | `session.ncoCallsign` | "N7BDD" |
| `{{ncoName}}` | `session.ncoName` | "Brian Darby" |
| `{{ncoLocation}}` | `session.ncoLocation` | "Hillsboro" |
| `{{netType}}` | `session.netType` | "Weekly Practice" |
| `{{netName}}` | `template.name` | "WashCoARES Weekly Net" |

### Tonight's repeater variables

Resolved from the `RepeaterEntry` the NCO selects as "Tonight's Repeater" at session start.
For linked-only systems (e.g. Oregon ARES D1) and for "None / Other" selection: all four resolve to empty string.

**Note:** `{{frequency}}` means *tonight's selected repeater*, not necessarily the system's designated primary. A template that uses `{{frequency}}` in the preamble will show whichever repeater the NCO chose for tonight — which could be the primary or an alternate.

| Variable | Source |
|---|---|
| `{{frequency}}` | Tonight's `Frequency` |
| `{{plTone}}` | Tonight's `PlTone` |
| `{{repeaterName}}` | Tonight's `RepeaterName` |
| `{{repeaterCredit}}` | Tonight's `ClosingCredit` |

### Primary repeater variables

From first `type === 'primary'` entry (lowest DisplayOrder). Empty string if no primary row.

| Variable | Source |
|---|---|
| `{{primaryName}}` | Primary `RepeaterName` |
| `{{primaryFrequency}}` | Primary `Frequency` |
| `{{primaryPlTone}}` | Primary `PlTone` |
| `{{primaryDescription}}` | Primary `Description` (e.g. club/owner name) |

### Alternate repeater variables

From `type === 'alternate'` entries sorted by DisplayOrder.

| Variable | Source |
|---|---|
| `{{alternateName}}` | First alternate `RepeaterName` |
| `{{alternateFrequency}}` | First alternate `Frequency` |
| `{{alternatePlTone}}` | First alternate `PlTone` |
| `{{alternateDescription}}` | First alternate `Description` |
| `{{alternateNames}}` | All alternate `RepeaterName` values, comma-separated |

### Linked repeater variables

From `type === 'linked'` entries sorted by DisplayOrder.

`{{linkedFull}}` format: each entry as `"RepeaterName Frequency / PlTone"`, entries comma-separated.
Example: `"W7XYZ 147.320 MHz / 100.0 Hz, K7ABC 442.325 MHz / 100.0 Hz"`

| Variable | Source |
|---|---|
| `{{linkedNames}}` | All linked `RepeaterName` values, comma-separated |
| `{{linkedFull}}` | All linked as "Name Frequency / PlTone", comma-separated |
| `{{linkedCount}}` | Count of linked entries |

### Link entry variables

From entries where `type` does not case-insensitively match `'primary'`, `'linked'`, or `'alternate'`.
`{{links}}` uses the raw stored `Type` string for display labels.

| Variable | Source |
|---|---|
| `{{echolinkNode}}` | `RepeaterName` of first entry where `type.toLowerCase() === 'echolink'`; empty if none |
| `{{links}}` | All link entries as "Type: RepeaterName", comma-separated |

### System variable

| Variable | Source |
|---|---|
| `{{systemName}}` | `RepeaterSystem.name` |

---

## Seeded default template

Seeded only when `created === true` from `getOrCreateSheetWithHeader`. Section `id` values generated by `Utilities.getUuid()` in `seedDefaultTemplate()`.

### WashCoARES Weekly Net (IsDefault: true)

**Preamble:**
```
Good evening. This is {{ncoCallsign}}, your net control station for this session of the Washington County Amateur Radio Emergency Service Net. This is a directed net. Those stations checking into the net are expected to monitor unless they request to be excused.

Regular sessions of this net meet Tuesdays at 7 p.m. local time except for meeting night, which is the third Tuesday of each month. This net is sanctioned to meet on the {{primaryDescription}} {{primaryFrequency}} repeater with a {{primaryPlTone}} tone which is our primary Net frequency. Our alternate frequency is the {{alternateFrequency}} repeater with a {{alternatePlTone}} tone.

Please refrain from using the word break unless you have a bona-fide emergency. Stations using the word break will be assumed to be indicating an emergency transmission.

All stations standby for net check in. Check-ins will be in alphabetical order of call sign suffixes. Visitor check-ins will occur after the regular member check-ins. This is {{ncoCallsign}}, located in {{ncoLocation}}, and my name is {{ncoName}}. The net is now open for check-ins.
```

**Sections** (10 sections; `notes` shown where the real script includes NCO instructions):

| Order | Title | callToAir | notes |
|---|---|---|---|
| 1 | A through D | Alpha through Delta — please call now. | |
| 2 | E through H | Echo through Hotel — please call now. | |
| 3 | I through L | India through Lima — please call now. | |
| 4 | M through R | Mike through Romeo — please call now. | |
| 5 | S through Z | Sierra through Zulu — please call now. | |
| 6 | Late or Missed | Are there any late or missed ARES member check-ins? | |
| 7 | Visitors | Are there any visitor check-ins for the Washington County ARES net this evening? | Ask for call, name, location, and any ARES or ARRL position. |
| 8 | Announcements | The net should be aware of the following upcoming ARES events. | Announce events from the WashCoARES website calendar for the next two weeks. Read any QSTs submitted by the EC. |
| 9 | Business | Is there any other business, questions, or discussion for the net? | |
| 10 | Last Call | Last call for late or missed member or visitor check-ins. | |

**Credits:**
```
This is {{ncoCallsign}}, your net control for this session of the Washington County Amateur Radio Emergency Service Net.

{{repeaterCredit}} I also thank everyone who has participated in the net this evening. This session of the Washington County ARES Net is now closed, and the frequency is now open for regular traffic. 73 everyone. {{ncoCallsign}} clear.
```

`{{repeaterCredit}}` resolves to the ClosingCredit of whichever repeater was Tonight's Repeater — one Credits template covers all three WashCoARES repeater variations.

---

## Server functions

### `getRepeaterSystems(): GetRepeaterSystemsResult` (new)

Read-only, no lock. Reads all `IsActive = TRUE` Repeaters rows. Groups by `SystemName`, sorts within each group by `DisplayOrder`. Classifies each row: `type.toLowerCase()` matched against `'primary'`/`'linked'`/`'alternate'`; everything else → `links[]`. Returns `RepeaterSystem[]` sorted alphabetically by `name`.

---

### `getTemplates(): GetTemplatesResult` (new)

Read-only, no lock. Returns all non-deleted rows sorted by `Name` ascending; tiebreaker: `CreatedAt` ascending. Parses `SectionsJson` server-side. On JSON parse error: returns that template with `sections: []` and `sectionsParseError: true` — the client shows a warning pill in the picker so the admin knows to fix the row.

---

### `saveTemplate(input: SaveTemplateInput): SaveTemplateResult` (new)

```
1. callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase().
   If !callerEmail → return NOT_AUTHORIZED.

2. Load PROP_ADMIN_EMAILS. If callerEmail not in list → return NOT_AUTHORIZED.
   [callerEmail is stored directly as UpdatedBy — no callsign lookup needed.]

3. Validate input fields:
   - template.templateId: non-empty, ≤ MAX_ID_FIELD.
   - template.name: non-empty, ≤ MAX_TEMPLATE_NAME (100).
   - template.preamble: ≤ MAX_PREAMBLE (5000).
   - template.credits: ≤ MAX_CREDITS (2000).
   - template.sections: array length 0–MAX_SECTIONS_PER_TEMPLATE (20).
     Each section: title ≤ MAX_SECTION_TITLE (100),
                   callToAir ≤ MAX_SECTION_CALL_TO_AIR (500),
                   notes ≤ MAX_SECTION_NOTES (500),
                   id non-empty.
   - Section ids must be unique within the array → INVALID_INPUT if duplicates.
   - Section order values must be unique positive integers → INVALID_INPUT if not.
   Return INVALID_INPUT with field + reason for any failure.

4. Acquire getScriptLock().tryLock(10_000). Failure → return BUSY_TRY_AGAIN.

5. Read all Templates rows.

6. Determine create vs. update:
   - Find row where TemplateId === input.template.templateId AND DeletedAt is blank.
   - Also check for a soft-deleted row with the same TemplateId — if found (DeletedAt non-blank),
     return INVALID_INPUT (field: 'templateId', reason: 'ID belongs to a deleted template;
     generate a new UUID').
     [This prevents recycling soft-deleted IDs and corrupting audit history.]
   - If matching active row found → update path.
   - If no row found → create path. Set CreatedAt = now (ISO-8601 UTC).

7. IsDefault enforcement (both create and update paths):
   - If input.template.isDefault === true → clear IsDefault on all other non-deleted rows.
   - If input.template.isDefault === false:
     - If this is the update path AND the existing row currently has IsDefault = true
       AND no other non-deleted row has IsDefault = true
       → release lock, return INVALID_INPUT (field: 'isDefault',
         reason: 'Cannot remove the default flag — set another template as default first').
     - If this is the create path AND no non-deleted row currently has IsDefault = true
       AND no other non-deleted row will have IsDefault = true after this write
       → release lock, return INVALID_INPUT (field: 'isDefault',
         reason: 'No default template exists — set this template as default').

8. Write row (upsert or append). Set UpdatedAt = now, UpdatedBy = callerEmail.

9. Release lock.

10. Return { ok: true, templateId: input.template.templateId, updatedAt }.
```

---

### `deleteTemplate(templateId: string): DeleteTemplateResult` (new)

```
1. callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase().
   If !callerEmail OR not in PROP_ADMIN_EMAILS → return NOT_AUTHORIZED.

2. Validate templateId: non-empty, ≤ MAX_ID_FIELD.
   → INVALID_INPUT with field: 'templateId', reason: 'Required' if empty.

3. Acquire getScriptLock().tryLock(10_000). Failure → return BUSY_TRY_AGAIN.

4. Find row where TemplateId === templateId AND DeletedAt is blank.
   Not found → release lock, return NOT_FOUND.

5. If this is the sole remaining non-deleted template
   (count of non-deleted rows after deleting this one = 0)
   → release lock, return INVALID_INPUT
     (field: 'templateId', reason: 'Cannot delete the only remaining template').

6. If row IsDefault === true
   → release lock, return INVALID_INPUT
     (field: 'templateId', reason: 'Cannot delete the default template — set another as default first').

7. Set DeletedAt = now.

8. Release lock.

9. Return { ok: true }.
```

---

### `startSession` (updated)

Server writes three new optional fields with `clampString`:

```typescript
row[SessionsCol.NCOName]       = clampString(input.ncoName,        MAX_NCO_NAME);
row[SessionsCol.NCOLocation]   = clampString(input.ncoLocation,    MAX_NCO_LOCATION);
row[SessionsCol.RepeaterSystem]= clampString(input.repeaterSystem, MAX_SYSTEM_NAME);
```

Both `ncoName` and `ncoLocation` must also be validated in `validateStartSessionInput` (same pattern as existing optional fields: skip if absent, clamp if present).

---

## Client changes

### Session-start form

`getTemplates()` and `getRepeaterSystems()` called in parallel via `google.script.run`. Both dropdowns show "Loading…" until resolved; on failure fall back to "No Script" / "None / Other".

New fields (below existing NCO Callsign field):

| Field | Type | Notes |
|---|---|---|
| **Your Name** (`ncoName`) | text, `maxlength="100"` | |
| **Your Location** (`ncoLocation`) | text, `maxlength="100"` | |
| **Repeater System** | dropdown | From `getRepeaterSystems()`, sorted alphabetically; includes "None / Other" at bottom |
| **Tonight's Repeater** | dropdown | **Conditional** — see below |
| **Net Script** | dropdown | From `getTemplates()` sorted by Name; includes "No Script" at top |

**Tonight's Repeater sub-picker logic:**
- Shown when `system.primary.length > 0 OR system.alternate.length > 0`.
- Hidden (not rendered) for linked-only systems and for "None / Other".
- Options: `system.primary` entries first, then `system.alternate` entries, each sorted by `displayOrder`. Each option displays `RepeaterName` (and freq/PL if "Show details" toggle is active).
- Option value: the entry's `displayOrder` within the combined `[...system.primary, ...system.alternate]` array. Since DisplayOrder is unique within a system, it is a stable key.
- Default selection: `system.primary[0]` (lowest DisplayOrder primary). If no primary exists (primary-only alternates): `system.alternate[0]`.
- On selection, the four tonight's-repeater variables are resolved from that entry.
- For linked-only systems and "None / Other": `{{frequency}}`, `{{plTone}}`, `{{repeaterName}}`, `{{repeaterCredit}}` all resolve to empty string.

A read-only summary line below Repeater System shows the system's entries (names only by default; "Show details" toggle reveals frequencies and PL tones).

The legacy free-text **Repeater** field (existing) is shown only when "None / Other" is selected. Its value is stored at `SessionsCol.Repeater` (col 7). When a real Repeater System is selected, col 7 is written as empty string.

Variable resolution happens when the user presses **Start Session** — not live-updated as dropdowns change. `ActiveScript` is built once at session start from the final form values.

`input.repeaterSystem` = selected `SystemName`, or `''` for "None / Other".

---

### sessionStorage key schema for recognition state

Keys: `recog-{sessionId}-{checkinId}`, value `'true'` or `'false'`.

At session start: iterate all `sessionStorage` keys; remove any where the `sessionId` segment does not match the current `sessionId`. This purges stale state from prior sessions or crashed sessions.

Amber warning on "Next Section" button: any `recog-{currentSessionId}-*` key with value `'false'`. This is session-wide (not per-section) because section tagging is deferred. The amber tells the NCO "there are unrecognized stations somewhere in this session."

---

### Script panel — three-phase flow

`ActiveScript` is `null` in "No Script" mode. All section-advance and phase-navigation code guards for `activeScript === null` and skips to the logging view.

When a template is selected at session start:
1. Build `vars` map from all variable groups.
2. `substitutedPreamble = substituteVariables(template.preamble, vars)`.
3. `substitutedCredits = substituteVariables(template.credits, vars)`.
4. `substitutedSections = template.sections.map(s => ({ ...s, substitutedCallToAir: substituteVariables(s.callToAir, vars) }))`. **`s.notes` is not passed through `substituteVariables` — it is stored and displayed raw.**
5. Store as `ActiveScript`.

**Phase: Preamble.** Scrollable text showing `substitutedPreamble`. "Begin Net →" button — plain tap (not hold-to-advance). Tapping advances to Phase: Section, `currentSectionIndex = 0`.

**Phase: Section.**
- Section title (smaller text).
- `substitutedCallToAir` in large text (18pt+).
- Section `notes` (if non-empty) in muted color, smaller font, visually separated — not read on air.
- Progress indicator: "Section 2 of 9".
- Log area (existing check-in UI).
- **"Next Section →"** — hold-to-advance (1.5 s ring). On last section: label becomes "Read Credits →".
- Amber if any `recog-{sessionId}-*` = `'false'` in sessionStorage. A hold still advances.
- **"← Back"** (smaller, top-left) — plain tap, steps back one section; logged check-ins retained.

**Phase: Credits.** `substitutedCredits` in large text. **"End Net"** button — plain tap. Proceeds to existing `endSession` flow.

---

### Section advance — hold-to-advance implementation

Events: `pointerdown` / `pointerup` / `pointercancel`. Start 1.5 s timer on `pointerdown`. Cancel timer on `pointerup` if elapsed < 1.5 s, or on `pointercancel` (scroll gesture). Call `event.preventDefault()` on `pointerdown` to suppress synthetic `click`; also call `el.focus()` explicitly in the `pointerdown` handler (required for iOS Safari, which suppresses automatic focus when `preventDefault` is called). Circular progress ring fills during hold; releases before 1.5 s resets it.

---

### Template editor (AdminEmails users only)

Accessible via "Scripts" button in session-start screen. Client-side visibility check (callerEmail in `PROP_ADMIN_EMAILS`); server enforces on every `saveTemplate` / `deleteTemplate` call.

**"New Script" flow:** clicking "New Script" generates a client-side UUID via `crypto.randomUUID()` (or a fallback polyfill) and creates a blank `NetTemplate` object with that UUID as `templateId`. The template is not saved until the admin presses Save.

Editor layout:
- Template list (top list on mobile; left panel on wider screens): tap to load.
- Edit fields:
  - **Name** — text input.
  - **Preamble** — `<textarea>` with variable-hint chips.
  - **Sections** — ordered list. Each row: Title | Call-to-air | Notes (NCO instruction) | Delete. "Add Section" at bottom. Up/down buttons for reorder (drag deferred). New section: `id = crypto.randomUUID()`.
  - **Credits** — `<textarea>` with variable-hint chips.
  - **Set as Default** — checkbox.
- **Save** — calls `saveTemplate`. On success: shows "Saved by {{updatedBy}} at {{updatedAt}}" inline.
- **Delete** — "Hold to delete" 1.5 s ring (same pointer event pattern as section advance); disabled when template is IsDefault.
- Attribution line: "Last updated by {{UpdatedBy}} on {{UpdatedAt}}."

**Variable-hint chips** (insert at cursor position using direct value splice — `execCommand` is deprecated):

```javascript
function insertChip(textarea, chip) {
  const start = textarea.selectionStart;
  const end   = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, start) + chip + textarea.value.slice(end);
  textarea.selectionStart = textarea.selectionEnd = start + chip.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
```

Chips shown in both Preamble and Credits hint bars:
```
{{date}}  {{ncoCallsign}}  {{ncoName}}  {{ncoLocation}}  {{netType}}  {{netName}}
{{frequency}}  {{plTone}}  {{repeaterName}}  {{repeaterCredit}}
{{primaryName}}  {{primaryFrequency}}  {{primaryPlTone}}  {{primaryDescription}}
{{alternateName}}  {{alternateFrequency}}  {{alternatePlTone}}  {{alternateDescription}}  {{alternateNames}}
{{linkedNames}}  {{linkedFull}}  {{linkedCount}}
{{echolinkNode}}  {{links}}  {{systemName}}
```

All text content inserted into DOM via `textContent`. Template text stored as plain strings in Sheet — never rendered as HTML.

---

## `setupSheets` updates

- `getOrCreateSheetWithHeader('Templates', TEMPLATES_HEADERS)` → if `created === true`: call `seedDefaultTemplate()`.
- `getOrCreateSheetWithHeader('Repeaters', REPEATERS_HEADERS)` → if `created === true`: call `seedDefaultRepeaters()`.
  Note: existing deployments that already have a Repeaters tab (from an earlier version) will not have the two new columns (`Description`, `ClosingCredit`). Add a check: if the Repeaters header row has fewer than 9 columns, extend it with the two new headers and note in the deploy checklist.
- Sessions header migration: if `headerRow.length < 15`, call `sheet.getRange(1, 13, 1, 3).setValues([['NCOName', 'NCOLocation', 'RepeaterSystem']])` then `sheet.setFrozenRows(1)`.
- `SetupSheetsResult.created` union updated (see TypeScript interfaces section).

---

## Security & constraints review

- **HtmlService XSS:** All template-derived text via `textContent` only. `insertChip` uses direct string manipulation — no innerHTML path.
- **AdminEmails gate:** `!callerEmail` guard before allowed-list check in both `saveTemplate` and `deleteTemplate`, consistent with existing `setupSheets` pattern.
- **LockService:** No nested lock calls. `saveTemplate` and `deleteTemplate` each acquire `getScriptLock()` once and release in all exit paths.
- **`UpdatedBy` = Google email:** natural attribution for a Google-authenticated system. Templates tab should be restricted in Sheet sharing to AdminEmails users.
- **Client-generated `TemplateId`:** used as-is on both create and update. Soft-deleted ID recycling blocked in step 6 of `saveTemplate` (INVALID_INPUT if matching soft-deleted row exists).
- **No new OAuth scopes:** Templates and Repeaters live in the existing Spreadsheet.
- **6-minute limit:** all new functions are single-sheet reads or single-row writes.
- **`startSession` migration:** three new optional fields; existing clients get empty strings.
- **Repeater data exposure:** `getRepeaterSystems()` has no auth gate. Trustees must not store non-published tactical repeater data if the web app is publicly accessible. `setupSheets` log output should include a reminder.
- **iOS Safari focus:** `el.focus()` called explicitly in `pointerdown` handler before starting the hold timer.

---

## Verification criteria (smoke test after deploy)

1. `setupSheets` creates Templates and Repeaters tabs with correct 10- and 9-column headers and seeded rows.
2. WashCoARES system appears in Repeater System dropdown. Tonight's Repeater sub-picker shows (primary + 2 alternates).
3. Oregon ARES D1 does NOT appear (all rows IsActive = FALSE).
4. Selecting WORC (primary): `{{frequency}}` = "145.450 MHz", `{{primaryDescription}}` = "Western Oregon Radio Club, Inc.", `{{repeaterCredit}}` = "We thank the Western Oregon Radio Club…"
5. Switching Tonight's Repeater to "Wes Allen": `{{repeaterCredit}}` = "We thank the family of Wes Allen…"
6. Variable substitution: name "Brian Darby", location "Hillsboro" — verify preamble shows correct values.
7. `{{primaryFrequency}}` = "145.450 MHz", `{{alternateFrequency}}` = "440.350 MHz" in preamble.
8. Preamble phase: "Begin Net" is plain tap; tapping advances to section 1.
9. Section notes shown in muted style; `substitutedCallToAir` does not include notes text.
10. Hold-to-advance: short tap does not advance; 1.5 s hold advances. Ring fills correctly.
11. Amber: leave recognition unchecked; verify amber on "Next Section". Hold advances (soft gate).
12. "← Back" is plain tap; steps back; existing check-ins retained.
13. Credits: "End Net" is plain tap; `{{repeaterCredit}}` correct in credits text.
14. "No Script" mode: `ActiveScript = null`; session starts directly in logging view.
15. Template save (admin): `UpdatedBy` = admin's Google email; `UpdatedAt` correct; row appears in Sheet.
16. Template save (non-admin): returns NOT_AUTHORIZED.
17. New template created with client-generated UUID: UUID persisted in TemplateId column.
18. Attempt save with soft-deleted template's UUID: returns INVALID_INPUT.
19. Delete non-default template: `DeletedAt` set; disappears from picker; row retained.
20. Delete default template: returns INVALID_INPUT.
21. Delete sole remaining template: returns INVALID_INPUT.
22. IsDefault enforcement: marking second template as default clears the first.
23. Create with `isDefault: false` when no default exists: returns INVALID_INPUT.
24. NCOName, NCOLocation, RepeaterSystem written to Sessions cols 12–14.
25. Page-refresh recovery: stale sessionStorage keys purged; no false amber.
26. `sectionsParseError`: corrupt SectionsJson cell → template appears in picker with warning pill; `sections: []`; `sectionsParseError: true`.
27. `{{unknown}}` renders as `{{unknown}}` in client.
28. `{{linkedFull}}` format: "W7XYZ 147.320 MHz / 100.0 Hz, K7ABC 442.325 MHz / 100.0 Hz" (space-slash-space separator).
29. Variable-hint chips: all chips from the full list present and insert correctly via direct splice.

---

## Open questions

1. **Link type names.** Brian will finalize EchoLink/AllStar/IRLP/etc. display names. Variable names (`{{echolinkNode}}` etc.) updated to match. Schema accepts free-text strings now.
2. **Repeaters tab migration.** Existing Repeaters tab (from earlier version) lacks `Description` and `ClosingCredit` columns. `setupSheets` should detect and extend. Confirm safe to run against production Sheet.
3. **D1 closing credit.** Linked system; `{{repeaterCredit}}` = empty string; D1 template Credits section simply does not use it. Acceptable for v1.
4. **Sessions header migration safety.** Confirm with trustee before running `setupSheets` against production Sheet.
5. **Sections reorder.** Up/down buttons for v1; drag deferred. Acceptable.
6. **`crypto.randomUUID()` availability.** Available in modern Chrome (including Android Chrome used for HtmlService). Confirm or provide a polyfill for the template editor's "New Script" and "Add Section" flows.

---

## Change log

| Date | Round | Summary |
|---|---|---|
| 2026-05-14 | 0 | Initial draft |
| 2026-05-14 | 1 | Bee review fixes; repeater model (Description, ClosingCredit, type taxonomy, RepeaterSystem interface); TemplateSection.notes; seeded WashCoARES template; D1 seed rows IsActive=FALSE |
| 2026-05-14 | 2 | UpdatedBy = Google email (no callsign lookup); client-generates TemplateId UUID; sectionsParseError flag on NetTemplate; soft-deleted ID recycling guard; zero-default guard on create path; sole-remaining-template guard on deleteTemplate; execCommand replaced with direct splice + el.focus() for iOS; Tonight's Repeater option key (DisplayOrder); Tonight's Repeater default when no primary (first alternate); "None/Other" resolves tonight's vars to empty string; ActiveScript\|null for No Script; {{date}} format specified; {{linkedFull}} format specified; {{links}} uses raw Type string; Type classification normalized separately from display; RepeaterSystem[] sorted alphabetically; getTemplates() tiebreaker (CreatedAt); full chip list; "Begin Net"/"End Net" are plain taps; maxlength on ncoName/ncoLocation; SetupSheetsResult.created union updated; Sessions header migration mechanism specified; notes not substituted |
