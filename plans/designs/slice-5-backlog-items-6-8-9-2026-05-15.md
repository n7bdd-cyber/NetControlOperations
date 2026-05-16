# Design Doc: Slice 5 Backlog Items — Items 6, 8, 9

**Date:** 2026-05-15
**Revision:** 2026-05-15 — initial draft
**Source:** Design conversation with Brian Darby on 2026-05-15; based on code review of `src/html/index.html`, `src/server/types.ts`, `src/server/main.ts`, and `plans/designs/slice-4-net-script-2026-05-14.md`.
**Implements PRD FRs:** None directly — backlog improvements and new feature.

**PRD divergences:** None — all items are additive or refining existing behavior.

**Depends on:** Slice 4 (Templates, Repeaters, hold-to-advance, template editor, repeater system picker fully shipped and tested).

**Defers (not in this doc):**
- Repeaters editor UI (edit Repeater rows in-app instead of directly in Sheet) — future slice.
- Template version history beyond last-editor — future slice.
- Drag-to-reorder sections — deferred from Slice 4, still deferred.

---

## Item 6 — Hold duration halved (1.5 s → 0.75 s)

### Why

The 1.5-second hold is longer than it needs to be for a user who already knows the gesture. NCOs running fast-paced suffix-letter sections have to pause for a full one-and-a-half seconds before they can move on. Halving to 0.75 s keeps the accidental-tap guard while cutting the interruption in half. This is a one-liner change in practice, but it touches two places — one in JS and one in CSS — and both must move together or the visual fill will not match the actual trigger time.

---

### Scope

**In:**
- `setupHoldButton` JS timer: `1500` → `750`.
- `.hold-btn.holding::after` CSS transition: `1.5s linear` → `0.75s linear`.
- `loadTemplateIntoEditor` tooltip text: `'Hold 1.5 s to delete'` → `'Hold 0.75 s to delete'`.

**Out:**
- No change to which buttons use `setupHoldButton` — both `btn-next-section` and `btn-delete-template` automatically inherit the new duration because they share the same helper and CSS class.
- No change to pointer event wiring, amber behavior, or iOS focus call.

---

### TypeScript interfaces

No changes.

---

### Server functions

No changes.

---

### Client changes

Three locations in `src/html/index.html`. All three must be updated in the same edit session.

**Location 1 — CSS rule (line ~136):**

```css
/* Before */
.hold-btn.holding::after { width: 100%; transition: width 1.5s linear; }

/* After */
.hold-btn.holding::after { width: 100%; transition: width 0.75s linear; }
```

**Location 2 — `setupHoldButton` JS timer (line ~1050):**

```javascript
/* Before */
holdTimer = setTimeout(function() {
  holdTimer = null; btn.classList.remove('holding'); onComplete();
}, 1500);

/* After */
holdTimer = setTimeout(function() {
  holdTimer = null; btn.classList.remove('holding'); onComplete();
}, 750);
```

**Location 3 — `loadTemplateIntoEditor` tooltip text (line ~1542):**

```javascript
/* Before */
delBtn.title = t.isDefault ? 'Cannot delete the default template' : 'Hold 1.5 s to delete';

/* After */
delBtn.title = t.isDefault ? 'Cannot delete the default template' : 'Hold 0.75 s to delete';
```

There are no other hardcoded occurrences of `1500` or `1.5s` in the hold-button path. The value `1500` that appears in the `callWithRetry` backoff array (`var backoffs = [250, 500, 1000]`) is unrelated and must not be changed.

---

### Verification criteria

1. On the logging screen, a tap shorter than 0.75 s does not advance the section. The fill bar starts but resets on pointer-up.
2. A hold of exactly 0.75 s (or longer) advances the section. The fill bar completes before the advance fires.
3. In the template editor, a hold shorter than 0.75 s on "Hold to Delete" does not trigger `onEditorDelete`.
4. A hold of 0.75 s on "Hold to Delete" triggers the delete flow.
5. The tooltip text on the delete button reads "Hold 0.75 s to delete" when the template is not the default.
6. The fill bar visual duration matches the actual trigger duration — no visible desync between animation and action.

---

### Open questions

None. This is a self-contained number change.

---

---

## Item 8 — Hold-button full-background fill (accessibility)

### Why

The current hold animation is a 4 px strip at the bottom of the button (`height: 4px; bottom: 0`). For users with low contrast sensitivity or small screens, this thin bar is too subtle to read as a progress indicator. It also does not meet the spirit of WCAG 2.1 SC 1.4.11 (Non-text Contrast) because the change in state is conveyed entirely by a narrow decorative line rather than a perceptible change to the button's primary visual region.

Replacing the strip with a full-height background fill makes the progress unmistakable — the button visually "fills in" from left to right as the user holds, and the text remains readable against the fill color at all times. This also doubles as a natural affordance: the NCO sees the button actively charging, which reinforces the hold-gesture mental model.

Both hold buttons — `btn-next-section` ("Click and Hold for Next Section") and `btn-delete-template` ("Hold to Delete") — share the `.hold-btn` class and will both inherit the new behavior automatically.

---

### Scope

**In:**
- Replace the `.hold-btn::after` CSS strip implementation with a full-height `::after` overlay approach.
- The fill color must provide sufficient contrast against the white button label text at all opacity levels encountered during the fill animation. A semi-transparent white overlay on the existing button background colors (`#0b69d3` blue for the next-section button; `#777` gray for the delete button; `#b07d00` amber when unrecognized check-ins exist) meets this requirement.
- The `::after` element must be `z-index: 0` so the button's text node (which has no explicit z-index but is in normal flow) renders above the fill. The label text must stay fully readable throughout the fill.

**Out:**
- No change to `setupHoldButton` JS logic — the `.holding` class toggle is the same mechanism. Only the CSS changes.
- No change to which buttons use `setupHoldButton`.
- No change to the `.btn-amber` amber color — the fill overlay is color-agnostic; it will work on amber just as on blue and gray.
- No change to the `transition` duration (which will be 0.75 s after Item 6 is applied, or 1.5 s if Item 6 is not yet applied — this item is independent).

---

### TypeScript interfaces

No changes.

---

### Server functions

No changes.

---

### Client changes

CSS only, in `src/html/index.html`. Replace the two existing `.hold-btn` rules (the base rule and the `.holding` modifier) with the implementation below.

**Current CSS (lines ~129–136):**

```css
/* Hold-to-advance fill bar */
.hold-btn { position: relative; overflow: hidden; }
.hold-btn::after {
  content: ''; position: absolute; bottom: 0; left: 0;
  height: 4px; width: 0%;
  background: rgba(255,255,255,0.65);
  transition: width 0s;
}
.hold-btn.holding::after { width: 100%; transition: width 1.5s linear; }
```

**Replacement CSS:**

```css
/* Hold-to-advance full-background fill (WCAG: full-height progress) */
.hold-btn { position: relative; overflow: hidden; }
.hold-btn::after {
  content: ''; position: absolute; top: 0; left: 0;
  height: 100%; width: 0%;
  background: rgba(255,255,255,0.30);
  transition: width 0s;
  z-index: 0;
  pointer-events: none;
}
.hold-btn.holding::after { width: 100%; transition: width 0.75s linear; }
.hold-btn > * { position: relative; z-index: 1; }
```

Note: the transition duration in the replacement above is `0.75s` because Item 6 is expected to be applied first. If Item 8 is applied without Item 6, change `0.75s` to `1.5s` to stay in sync with the JS timer.

**Why `rgba(255,255,255,0.30)` and not a darker fill:**

- The button backgrounds are all mid-to-dark colors (`#0b69d3`, `#777`, `#b07d00`). A 30% white overlay on these produces a visible but not blinding lightening — enough to read clearly as "filling" without washing out to near-white.
- At 0.30 opacity the overlay on `#0b69d3` (blue) produces approximately `#4d95de`, which has a contrast ratio of approximately 4.6:1 against white text — above the WCAG AA threshold of 4.5:1 for normal text.
- The unfilled left portion (the original button color) provides contrast ratios well above 4.5:1 against white text for all three button colors used in this app.

**Why `.hold-btn > * { position: relative; z-index: 1; }`:**

The `::after` pseudo-element is stacked using `z-index: 0` within the button's stacking context (established by `position: relative` on `.hold-btn`). Without an explicit `z-index: 1` on the button's direct children, the pseudo-element can render over the text node in some browsers (notably Chrome on Android). Adding `z-index: 1` to direct children of `.hold-btn` guarantees the text is always above the fill layer. This selector is scoped to `.hold-btn > *` only and does not affect any other element.

**`pointer-events: none` on `::after`:**

Prevents the fill overlay from intercepting pointer events that the parent button needs for the `pointerdown`/`pointerup`/`pointercancel` listeners.

---

### Verification criteria

1. Before holding: both hold buttons display their normal background color with no visible fill layer.
2. During a hold: a white-tinted overlay sweeps left to right across the full height of the button at the same rate as the JS timer.
3. The button label text ("Click and Hold for Next Section", "Hold to Delete") remains fully legible throughout the entire sweep — no moment where the fill obscures the text.
4. Releasing the hold before completion: the fill resets instantly (no animation on reset, same as current behavior).
5. On the amber ("btn-amber") state of the next-section button: the sweep is visible on the amber background, and the label text remains legible.
6. On a small phone screen (360 px wide), the fill is visually obvious and covers the full button height.
7. No other buttons on the page are visually affected (the `.hold-btn > *` rule is scoped to hold buttons only).
8. Automated axe or Lighthouse accessibility audit: no new contrast failures introduced.

---

### Open questions

1. **Opacity tuning.** The 0.30 value is a starting point based on calculated contrast ratios. After deploying on a real device, check on the amber state — the amber `#b07d00` is lighter than the blue and the fill may be harder to see. If so, increasing to 0.35 or adding a distinct fill color for `.btn-amber.hold-btn::after` is a minimal follow-on fix.
2. **Safari `::after` z-index behavior.** iOS Safari has historically had edge cases where `::after` z-index interacts unexpectedly with `overflow: hidden`. Test on an actual iPhone before declaring done.

---

---

## Item 9 — New-net script creation wizard

### Why

The current "New Script" flow in the template editor drops the admin directly into a blank form — no name, no repeater rows, no preamble, no sections. This is fine for editing an existing template, but it is hostile for someone standing up a brand-new net type from scratch. They face a blank page and have no scaffolding to guide them through what a complete, usable script looks like.

The target user for this wizard is a trustee or group leader who has just deployed NetControlOperations for a new ARES net or club net that does not yet have any template. They may be unfamiliar with the variable system, may not know what repeater rows to create, and may not realize that a script needs a preamble, sections, and credits to function end-to-end. The wizard walks them through exactly those decisions, one step at a time, and produces both a `NetTemplate` (saved to the Templates sheet) and the associated `RepeaterEntry` rows (saved to the Repeaters sheet) at the end.

The wizard does not replace the existing free-form editor. After the wizard completes, the admin can open the created template in the normal editor to refine it. The wizard is a first-run bootstrap, not a full editor replacement.

---

### Scope

**In:**
- A new multi-step wizard UI accessed via a "Use Wizard" button on the template editor list view (shown only to admins, alongside the existing "+ New Script" button).
- Six steps: (1) Name and net type, (2) Primary repeater and alternates, (3) Preamble with variable-hint chips, (4) Sections step by step, (5) Closing credits with variable-hint chips, (6) Review and save.
- On Save (Step 6): one `saveTemplate` call for the NetTemplate; one new `saveRepeaterSystem` server function call for any repeater rows the admin defined.
- New server function `saveRepeaterSystem(input: SaveRepeaterSystemInput): SaveRepeaterSystemResult` — admin-only, batch upsert of Repeater rows for a named system.
- New TypeScript interfaces: `SaveRepeaterSystemInput`, `SaveRepeaterSystemResult`, `WizardRepeaterRow`.
- Client: wizard state object `WizardState`; step-rendering functions; forward/back navigation; variable-hint chips in Steps 3 and 5 (reuse existing `insertChip` and `renderChipBar`).
- A read-only "What this variable does" tooltip or inline hint appears when the admin taps any chip for the first time in a session (dismissible).

**Out:**
- Editing an existing template via the wizard — the wizard is create-only. After completion the admin uses the free-form editor.
- Drag-to-reorder sections within the wizard — up/down buttons only, same as the free-form editor.
- Adding linked repeaters (EchoLink, AllStar, IRLP, etc.) via the wizard — link entries can be added in the Sheet directly or in the free-form editor. The wizard handles primary and alternate RF repeaters only.
- Previewing variable substitution in real time as the admin types — the full preview is available only after the template is saved and the admin opens a session.
- Auto-creating a second template for an alternate script variant — one template per wizard run.

---

### New server function: `saveRepeaterSystem`

#### Why a new function and not reusing the Repeater tab directly

The wizard needs to create or replace an entire system's rows atomically. Writing rows one at a time from the client would be fragile (partial failures, concurrent session interference). A single server call that takes the whole system as a batch is cleaner and follows the same lock pattern as `saveTemplate`.

The function does a full replace of the named system's rows: all existing rows for `systemName` are soft-deleted (set `IsActive = FALSE`) and the new rows are appended. This is simpler than a row-level diff and is safe because the wizard only runs once per new system.

#### TypeScript interfaces

Add to `src/server/types.ts`:

```typescript
export interface WizardRepeaterRow {
  repeaterName:  string;   // callsign or site name
  frequency:     string;   // e.g. "145.450 MHz"; blank for link entries
  plTone:        string;   // e.g. "107.2 Hz"; blank if none
  type:          string;   // 'primary' | 'alternate' (wizard handles only these two)
  displayOrder:  number;   // 1-based; wizard assigns sequentially
  description:   string;   // owner/club name
  closingCredit: string;   // closing credit text for {{repeaterCredit}}
}

export interface SaveRepeaterSystemInput {
  systemName: string;                // must be non-empty, ≤ MAX_SYSTEM_NAME (100)
  rows: WizardRepeaterRow[];         // 1–10 rows; wizard enforces max 1 primary + 4 alternates
}

export type SaveRepeaterSystemResult =
  | { ok: true; systemName: string; rowsWritten: number }
  | { ok: false; error: 'NOT_AUTHORIZED' }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };
```

No changes to `NetTemplate`, `TemplateSection`, `RepeaterSystem`, or `RepeaterEntry`.

#### Field-length caps (add to `types.ts`)

```typescript
export const MAX_REPEATER_NAME     = 50;
export const MAX_REPEATER_FREQ     = 20;
export const MAX_REPEATER_TONE     = 15;
export const MAX_REPEATER_DESC     = 150;
export const MAX_REPEATER_CREDIT   = 300;
export const MAX_WIZARD_REPEATER_ROWS = 10;
```

#### `saveRepeaterSystem(input: SaveRepeaterSystemInput): SaveRepeaterSystemResult` (new)

```
1. callerEmail = Session.getActiveUser().getEmail().trim().toLowerCase().
   If !callerEmail OR not in PROP_ADMIN_EMAILS → return NOT_AUTHORIZED.

2. Validate input:
   - systemName: non-empty, ≤ MAX_SYSTEM_NAME.
   - rows: array length 1–MAX_WIZARD_REPEATER_ROWS.
   - Exactly one row where type.toLowerCase() === 'primary'.
     (Wizard enforces this in client; server re-checks.)
     → INVALID_INPUT (field: 'rows', reason: 'exactly one primary row required') if violated.
   - Each row:
       repeaterName:  non-empty, ≤ MAX_REPEATER_NAME.
       frequency:     ≤ MAX_REPEATER_FREQ (blank allowed).
       plTone:        ≤ MAX_REPEATER_TONE (blank allowed).
       type:          must be 'primary' or 'alternate' (case-insensitive) for wizard rows.
       displayOrder:  positive integer, unique within the array.
       description:   ≤ MAX_REPEATER_DESC.
       closingCredit: ≤ MAX_REPEATER_CREDIT.
   → INVALID_INPUT with field + reason for any failure.

3. Acquire getScriptLock().tryLock(10_000). Failure → return BUSY_TRY_AGAIN.

4. Load all Repeaters rows.

5. Set IsActive = FALSE on all existing rows where SystemName === input.systemName AND IsActive = TRUE.
   (Soft-deactivate the old system. Rows are kept for historical integrity.)

6. Append new rows for input.rows, each with:
   - SystemName    = input.systemName
   - RepeaterName  = row.repeaterName
   - Frequency     = row.frequency
   - PlTone        = row.plTone
   - Type          = row.type  (stored with original case from input)
   - DisplayOrder  = row.displayOrder
   - IsActive      = TRUE
   - Description   = row.description
   - ClosingCredit = row.closingCredit

7. Release lock.

8. Return { ok: true, systemName: input.systemName, rowsWritten: input.rows.length }.
```

Note: `saveRepeaterSystem` does not touch the Templates sheet. The two server calls (saveRepeaterSystem + saveTemplate) are made sequentially from the client on Step 6 Save, not in a single transaction. If `saveRepeaterSystem` succeeds but `saveTemplate` fails, the admin will have new repeater rows but no template — this is acceptable because the admin can retry the save or use the free-form editor to finish. The wizard shows distinct error messages for each failure so the admin knows which piece to retry.

---

### Wizard state (client-side)

Add a `WizardState` object to the client script, alongside the existing `EditorState`:

```javascript
var WizardState = {
  // Step 1
  netName:     '',          // template name, e.g. "OurGroup Weekly Net"
  netType:     '',          // net type string, e.g. "Weekly Practice"
  systemName:  '',          // repeater system name, e.g. "OurGroup"

  // Step 2
  repeaterRows: [],         // array of WizardRepeaterRow draft objects

  // Step 3
  preamble: '',

  // Step 4
  sections: [],             // same structure as EditorState.sections

  // Step 5
  credits: '',

  // Step 6
  isDefault:   false,

  // Navigation
  currentStep: 1,           // 1–6
  saving:      false,
};
```

`WizardState` is initialized fresh each time the admin clicks "Use Wizard". It is not persisted across page loads.

---

### Wizard UI — screens and steps

The wizard lives in a new `<section id="screen-wizard">` inserted after `screen-editor` in the HTML. It shows one step at a time; all other steps are hidden. Navigation uses "Next →" and "← Back" plain buttons (not hold buttons). Progress is shown as "Step N of 6" in a header strip.

#### Step 1 — Name and net type

**Purpose:** give the script a name and set its net type string. These become `template.name` and the default `netType` hint shown to the NCO at session start.

**Fields:**

| Field | Type | Notes |
|---|---|---|
| **Script name** | text, `maxlength="100"` | e.g. "OurGroup Weekly Net". Required. |
| **Net type** | text, `maxlength="100"` | e.g. "Weekly Practice". Required. Prepopulates the `f-net-type` field in session start as a hint; the NCO can override it. |
| **System name** | text, `maxlength="100"` | Name for the repeater group, e.g. "OurGroup". Required. Used in Step 2 and stored as `RepeaterSystem.name`. Should match what the NCO will select in the Repeater System dropdown. |

**Guidance text (displayed in a `<p class="small">` below the fields):**

> The script name is what the NCO picks from the Net Script dropdown. The system name groups your repeaters together — use your club's call or short name.

**Validation on "Next →":** all three fields non-empty. No server call.

---

#### Step 2 — Repeaters

**Purpose:** define the primary repeater and any alternates. The wizard creates these as `RepeaterEntry` rows under the system name from Step 1. Link entries (EchoLink, AllStar, etc.) are out of scope for the wizard.

**Layout:**

- A list of repeater rows already added (initially empty except for one blank primary row pre-inserted for the admin to fill in).
- Each row shows: Repeater Name, Frequency, PL Tone, Type (radio: Primary / Alternate), Description, Closing Credit — laid out as stacked fields on mobile.
- A "Remove" button per row (disabled for the primary row — there must always be exactly one primary).
- An "+ Add Alternate" button that appends a new blank Alternate row.

**Constraints enforced in UI:**
- Exactly one Primary row at all times. The Primary radio button for the first row is selected and the row cannot be removed. All other rows default to Alternate.
- Maximum 4 Alternate rows (5 rows total). "+ Add Alternate" is hidden when 4 alternates exist.

**Guidance text:**

> Your primary repeater is the one you use for most nets. Alternates are fallbacks. The Closing Credit text goes on air at the end of each net — e.g. "We thank the XYZ Club for the use of the 145.450 MHz repeater."

**Variable hint chips** (shown below the Closing Credit field for each row, clicking inserts into that row's Closing Credit textarea):

```
{{repeaterName}}  {{frequency}}  {{plTone}}
```

**Validation on "Next →":**
- Repeater Name: required for all rows.
- Frequency: no format enforcement at this step; non-empty recommended but not required (blank allowed for simplex or tactical nets).
- At least one row (the primary) must be present.
- Client-side only; no server call.

---

#### Step 3 — Preamble

**Purpose:** write the opening words the NCO reads on air. Variable-hint chips make it easy to insert session variables without memorizing the syntax.

**Layout:**
- Full-width `<textarea maxlength="5000">` with the same styling as `ed-preamble`.
- Chip bar above the textarea (reuse `renderChipBar` with the same `SCRIPT_CHIP_VARS` list).
- "Start from a sample" button (shown only on Step 3): inserts a generic starter preamble into the textarea (see sample text below). If the textarea is non-empty, confirms before overwriting.

**Starter preamble (inserted by "Start from a sample" button):**

```
Good evening. This is {{ncoCallsign}}, your net control station for this session of the {{netName}}. This is a directed net.

This net meets on the {{primaryFrequency}} repeater with a {{primaryPlTone}} tone. Our alternate frequency is the {{alternateFrequency}} repeater.

All stations standby for net check-in. This is {{ncoCallsign}}, located in {{ncoLocation}}, and my name is {{ncoName}}. The net is now open.
```

**Guidance text:**

> Use the chips above to insert variables — they'll be replaced with real values when the NCO starts each net. Variables left unknown will appear as-is so you can spot and fix them.

**Validation on "Next →":** preamble may be blank (some nets have no formal preamble). No warning if blank; it is the admin's choice.

---

#### Step 4 — Sections

**Purpose:** add the sections of the net body — typically the suffix-letter groups and any special rounds.

**Layout:** identical to the sections editor in the free-form editor (`renderEditorSections`). The wizard calls a local `renderWizardSections()` function that renders into a dedicated container `wizard-sections-container`. It is safe to reuse the same `renderEditorSections` function by temporarily pointing `EditorState.sections` at `WizardState.sections`, but a separate render function avoids coupling WizardState to EditorState.

The wizard pre-populates three starter sections to give the admin a starting point:

| Order | Title | callToAir | notes |
|---|---|---|---|
| 1 | A through L | Alpha through Lima — please call now. | |
| 2 | M through Z | Mike through Zulu — please call now. | |
| 3 | Visitors | Are there any visitor check-ins? | Ask for call, name, and location. |

The admin can edit, remove, reorder, and add sections exactly as in the free-form editor.

**Guidance text:**

> Sections are the rounds of check-ins. Add as many as your net needs. The NCO will advance through them one by one using the hold-to-advance button.

**Validation on "Next →":** at least one section must be present. If none, show inline message "Add at least one section, or add a placeholder and edit it later." No server call.

---

#### Step 5 — Closing credits

**Purpose:** write the closing text read on air at the end of the net.

**Layout:**
- Full-width `<textarea maxlength="2000">` with same styling as `ed-credits`.
- Chip bar above the textarea (same `SCRIPT_CHIP_VARS`).
- "Start from a sample" button inserts a generic starter credits text.

**Starter credits text:**

```
This is {{ncoCallsign}}, your net control for this session of the {{netName}}.

{{repeaterCredit}} I also thank everyone who participated tonight. This session of the {{netName}} is now closed. 73 everyone. {{ncoCallsign}} clear.
```

**Guidance text:**

> {{repeaterCredit}} inserts the closing credit you wrote for tonight's repeater in Step 2. If the NCO uses a different repeater tonight, the right credit text shows automatically.

**Validation on "Next →":** credits may be blank. No server call.

---

#### Step 6 — Review and save

**Purpose:** show a summary of what will be created before committing anything to the Sheet. The admin can go back to any step to change a value. On Save, both the repeater rows and the template are written.

**Layout:**

A read-only summary card for each section of the wizard:

- **Script name** — `WizardState.netName`
- **Net type** — `WizardState.netType`
- **System name** — `WizardState.systemName`
- **Repeaters** — table: Name | Frequency | PL Tone | Type | Description (one row per `WizardState.repeaterRows`). Closing credits truncated to 60 chars with ellipsis.
- **Preamble** — first 200 chars with "…" if longer.
- **Sections** — numbered list of titles only.
- **Credits** — first 200 chars with "…" if longer.
- **Set as default?** — checkbox (default: checked if no other active template exists in `NetControl.templates`; unchecked otherwise). Inline warning if unchecked and no default exists: "There is no default script — check this box or set another script as default."

**"← Edit Step N" links** next to each summary block let the admin jump back to that step without losing data.

**"Save Script" button** — not a hold button; a plain tap. Disabled while saving. On tap:

```
1. Validate WizardState one final time (same rules as each step's Next validation).
   Show inline error if any check fails; do not proceed.

2. Set WizardState.saving = true. Disable Save button. Show "Saving…" status.

3. Call saveRepeaterSystem({ systemName: WizardState.systemName, rows: WizardState.repeaterRows }).
   On error: show error toast; set WizardState.saving = false; re-enable Save. Stop.

4. Build NetTemplate object from WizardState:
   - templateId:  uuid4()
   - name:        WizardState.netName
   - preamble:    WizardState.preamble
   - sections:    WizardState.sections (ids already assigned by wizard)
   - credits:     WizardState.credits
   - isDefault:   WizardState.isDefault (from checkbox on Step 6)
   - createdAt/updatedAt/updatedBy/deletedAt: blank (server fills these)

5. Call saveTemplate({ template: <above> }).
   On error: show error toast explaining that repeaters were saved but the script was not.
   Provide a "Try again" button that retries only the saveTemplate call (not saveRepeaterSystem).
   Set WizardState.saving = false; re-enable Save.

6. On both calls succeeding:
   - Reload getTemplates and getRepeaterSystems in parallel.
   - Update NetControl.templates, NetControl.repeaterSystems.
   - Update the session-start form dropdowns (updateNetScriptDropdown, updateRepeaterSystemDropdown).
   - Show success toast: "Script created. You can edit it in Manage Scripts."
   - Navigate to screen-editor (template list view), with the new template highlighted (EditorState.selectedId set to the new templateId).
   - Reset WizardState for next use.
```

**"Cancel" button** (secondary): discards all wizard state and navigates back to screen-editor. Shows a confirmation dialog (plain `window.confirm`) before discarding if any step has non-empty data.

---

### HTML structure

Add a new `<section id="screen-wizard">` to `ALL_SCREENS`. Structure:

```html
<!-- Screen 6: New Script Wizard -->
<section id="screen-wizard" aria-labelledby="wizard-title">
  <div class="header-strip">
    <span id="wizard-step-label" class="script-progress"></span>  <!-- "Step N of 6" -->
    <h1 id="wizard-title">New Net Script Wizard</h1>
  </div>

  <div id="wizard-step-1">...</div>   <!-- Step 1 fields -->
  <div id="wizard-step-2">...</div>   <!-- Step 2 repeater rows + Add Alternate -->
  <div id="wizard-step-3">...</div>   <!-- Step 3 preamble textarea + chips -->
  <div id="wizard-step-4">...</div>   <!-- Step 4 sections container -->
  <div id="wizard-step-5">...</div>   <!-- Step 5 credits textarea + chips -->
  <div id="wizard-step-6">...</div>   <!-- Step 6 review card + Save -->

  <div class="wizard-nav">
    <button id="wizard-btn-back" class="secondary" type="button">← Back</button>
    <button id="wizard-btn-next" type="button">Next →</button>
    <!-- Save button shown only on Step 6: -->
    <button id="wizard-btn-save" type="button" hidden>Save Script</button>
    <button id="wizard-btn-cancel" class="secondary" type="button">Cancel</button>
  </div>

  <p id="wizard-save-status" class="small"></p>
</section>
```

Step divs are toggled `hidden` as the admin navigates. Only one step div is visible at a time. The nav buttons ("← Back", "Next →", "Save Script") update their `hidden` state at each step change:
- Step 1: Back hidden; Next visible.
- Steps 2–5: Back visible; Next visible.
- Step 6: Back visible; Next hidden; Save visible.

---

### `ALL_SCREENS` update

Add `'screen-wizard'` to the `ALL_SCREENS` array alongside the existing six screens.

---

### Accessing the wizard

In the template editor list view (`screen-editor`, `#ed-list`), add a second button in `#ed-admin-header` visible only to admins:

```html
<button id="btn-use-wizard" type="button" class="secondary">Use Wizard</button>
```

Positioned after (below) the existing `+ New Script` button. Clicking `btn-use-wizard` calls `openWizard()`, which resets `WizardState`, shows Step 1, and calls `showScreen('screen-wizard')`.

---

### Variable-hint chips in Step 3 and Step 5

Reuse the existing `renderChipBar(containerId, textareaId)` function. The same `SCRIPT_CHIP_VARS` array is used. For Step 3 call `renderChipBar('wizard-preamble-chips', 'wizard-preamble')` and for Step 5 call `renderChipBar('wizard-credits-chips', 'wizard-credits')`.

---

### Section IDs in the wizard

Each section added in Step 4 needs a stable `id` field (UUID). Assign `uuid4()` at the moment the section is created (either the three pre-populated starters or when the admin taps "+ Add Section"). Do not reassign IDs on reorder — the existing `arr.forEach(function(s, j) { s.order = j + 1; })` pattern from the free-form editor updates `order` only.

---

### Interaction with existing `saveTemplate` and `saveRepeaterSystem` guards

- `saveTemplate` already enforces the IsDefault zero-default guard on the create path. The wizard's Step 6 checkbox logic mirrors this: if no other active template exists, the checkbox is pre-checked and a tooltip explains why. The admin can uncheck it only if they understand the consequence — `saveTemplate` will return `INVALID_INPUT` and the client will surface the error.
- `saveRepeaterSystem` sets `IsActive = FALSE` on old rows for the same `systemName` before appending new rows. This means running the wizard twice for the same system name replaces the system cleanly without leaving duplicate active rows.

---

### Verification criteria

**Wizard navigation:**
1. "Use Wizard" button appears only when `NetControl.isAdmin === true`.
2. Clicking "Use Wizard" shows Step 1 with all fields blank. `WizardState.currentStep === 1`.
3. "← Back" is hidden on Step 1.
4. Tapping "Next →" on Step 1 with any field blank shows an inline error and does not advance.
5. Tapping "Next →" with all Step 1 fields filled advances to Step 2.
6. On Step 6, "Next →" is hidden and "Save Script" is visible.
7. "← Back" on Step 2 returns to Step 1 with previously entered values preserved.
8. Navigating forward and back across all 6 steps does not lose any entered data.
9. "Cancel" with non-empty data shows a confirmation. Confirming returns to the template list view and resets WizardState.
10. "Cancel" with all fields blank navigates immediately without confirmation.

**Step 2 — Repeaters:**
11. One blank primary row is pre-populated. The "Remove" button is disabled for it.
12. "+ Add Alternate" appends a new blank Alternate row.
13. "+ Add Alternate" is hidden when 4 alternate rows already exist (5 rows total including primary).
14. "Remove" removes an Alternate row and renumbers `displayOrder` values sequentially.
15. "Next →" with a blank Repeater Name on any row shows an inline error per row.

**Step 3 — Preamble:**
16. Chip bar renders all `SCRIPT_CHIP_VARS` chips. Tapping a chip inserts the variable at the cursor position in the preamble textarea.
17. "Start from a sample" inserts the starter preamble text into the textarea.
18. "Start from a sample" when textarea is non-empty shows a confirmation before overwriting.

**Step 4 — Sections:**
19. Three starter sections are pre-populated.
20. Up/down buttons reorder sections and reassign `order` values.
21. "Next →" with zero sections shows an inline error.

**Step 5 — Credits:**
22. Chip bar renders all `SCRIPT_CHIP_VARS` chips.
23. "Start from a sample" inserts the starter credits text.

**Step 6 — Review and Save:**
24. All five summary blocks display data matching what was entered in Steps 1–5.
25. "← Edit Step N" links navigate back to the correct step without losing data.
26. "Set as default" checkbox is pre-checked when no other active template exists.
27. Unchecking "Set as default" when no other default exists shows the inline warning.
28. Tapping "Save Script" with a valid WizardState calls `saveRepeaterSystem` first, then `saveTemplate`.
29. On both calls succeeding: success toast shown; dropdowns updated; screen-editor shown with new template highlighted.
30. On `saveRepeaterSystem` failure: error toast shown; `saveTemplate` is not called; Save button re-enabled.
31. On `saveTemplate` failure after `saveRepeaterSystem` success: error explains which part failed; "Try again" retries only `saveTemplate`.
32. After a successful wizard run: the new system appears in the Repeater System dropdown on session-start. The new template appears in the Net Script dropdown.
33. Running the wizard a second time for the same system name replaces the active repeater rows (old rows set `IsActive = FALSE`).

**Server — `saveRepeaterSystem`:**
34. Non-admin caller returns `NOT_AUTHORIZED`.
35. Missing system name returns `INVALID_INPUT`.
36. Zero primary rows returns `INVALID_INPUT`.
37. Two primary rows returns `INVALID_INPUT`.
38. Row with blank `repeaterName` returns `INVALID_INPUT`.
39. Type value other than `primary`/`alternate` returns `INVALID_INPUT`.
40. Duplicate `displayOrder` within the array returns `INVALID_INPUT`.
41. Successful call: old rows for `systemName` set `IsActive = FALSE`; new rows appended with `IsActive = TRUE`.
42. Subsequent `getRepeaterSystems()` call returns only the new rows for the system (old rows filtered out by `IsActive = FALSE`).

---

### Open questions

1. **"Use Wizard" vs. "New Script" coexistence.** The wizard button and the free-form "New Script" button both live in `#ed-admin-header`. Confirm with Brian whether this is the right placement, or whether the wizard should be a modal/overlay that replaces the editor list entirely when opened.
2. **Starter section count.** Three pre-populated sections (A–L, M–Z, Visitors) is a starting point. Should the wizard offer a "What kind of net?" radio (suffix-group net / linked net / simplex net) in Step 1 that selects a different starter set? Deferred for now; three generic sections are safe for all net types.
3. **Repeater frequency format validation.** The wizard currently stores frequency as a free-text string (same as the Sheet). Should the wizard enforce a format like `NNN.NNN MHz`? Pros: consistent with existing seeded data and `{{frequency}}` variable output. Cons: adds friction for unusual frequencies (HF, microwave). Recommendation: leave free-text for v1; note on the field that the format used (e.g. "145.450 MHz") is what appears in the preamble.
4. **System name collision.** If the admin enters a system name that already exists in the Repeaters sheet (e.g. "WashCoARES"), `saveRepeaterSystem` will deactivate the existing rows and replace them. This could be destructive if done accidentally. Consider a warning on Step 1 if `WizardState.systemName` matches an existing `RepeaterSystem.name` in `NetControl.repeaterSystems`. Show: "A system named 'X' already exists — saving will replace its repeaters." The admin can still proceed.
5. **"Try again" retry on Step 6 template save failure.** The retry button reruns only `saveTemplate`. Confirm this is the right behavior — it is possible (though unlikely) that the repeater rows also need to be rewritten if the admin navigated away and back between the failure and the retry.
6. **Wizard accessibility.** Each step transition should move focus to the step heading or first field so keyboard/screen-reader users land in the right place. Add `setTimeout(function() { stepHeading.focus(); }, 0)` on each step transition.

---

## Change log

| Date | Round | Summary |
|---|---|---|
| 2026-05-15 | 0 | Initial draft — Items 6, 8, 9 |
