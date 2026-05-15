# ActivARES Net Control Operations — User Guide

---

## Part 1: NCO (Net Control Operator)

**Your job:** Run a directed net, capture every check-in, and produce a record the EC can use — without taking your hand off the mic.

---

### Before the Net: Starting a Session

Open the app and fill in the **Start Net** form:

| Field | What to enter |
|---|---|
| **Net date** | Defaults to today — change only if logging a past session |
| **Net time** | Defaults to now (24-hour, e.g. `19:00`) |
| **Net type** | Free text describing this net (e.g. `Weekly Practice Net`) |
| **NCO callsign** | Your callsign — letters and digits only (e.g. `W7ABC`) |
| **Your name** | Optional; fills the `{{ncoName}}` variable in the script |
| **Your location** | Optional; fills the `{{ncoLocation}}` variable |
| **Repeater system** | Pick the system in use tonight. If your system isn't listed, choose `None / Other` and type the repeater manually |
| **Tonight's repeater** | If the system has a primary and alternates, pick which one you're on tonight |
| **Net script** | Pick a script template; the default is pre-selected. Choose `No Script` to skip the teleprompter |
| **Purpose / notes** | Optional notes about this session |

Tap **Start Net** when ready.

---

### The Preamble

If you selected a script, the **Preamble** screen appears first. The full opening text is displayed — all variables (`{{date}}`, `{{ncoCallsign}}`, frequency, etc.) are already filled in. Read it on air, then tap **Begin Net →** to move to the logging screen.

- **Skip Script** discards the teleprompter for this session and goes straight to logging.

---

### Logging Check-ins

The logging screen is your main workspace. The header shows your callsign, net type, time, and the FCC ID timer.

**Logging a full callsign:**

1. Type the full callsign in the **Callsign** field (e.g. `KD7ABC`).
2. Tap **LOG** or press Enter.
3. The callsign appears at the top of the check-in list with a yellow flash. The name resolves automatically in the background.

**Logging with a suffix (Suffix-Tap):**

When stations check in faster than you can type full calls:

1. Type the last 2–3 letters of the callsign (e.g. `ABC`).
2. Tap **LOG** or press Enter.
3. A candidate list appears showing matches from the roster and recent check-ins. Stations already checked in tonight show a **this net** badge.
4. Tap the correct callsign to log it.
5. If nothing matches, the error message tells you to type the full callsign.

**Tap-to-add:** Logging the same callsign more than once increments the tap counter (×2, ×3…) — useful for stations that check in on multiple sections. Hours credit is counted once per unique callsign per net.

**Name resolution:** Names come from three sources, in priority order:
- The weekly roster sync (already loaded in the background)
- The FCC/HamDB database (async — shows **Searching…** briefly)
- Manual entry — if the lookup fails, a **Check back** button appears; tap it to type the name you heard

---

### Using the Script Panel

When a script is active and you're past the preamble, the **Script Panel** appears above the check-in log. It shows:

- **Section title** — the name of the current on-air segment
- **Call-to-air text** — exactly what to say, with variables filled in
- **NCO notes** — private reminders below a divider; these are not read on air
- **Section X of Y** — progress indicator

**Advancing sections:**

- Click and hold **Next Section** for 1.5 seconds. A white progress bar fills the button bottom.
- If any check-in in the current section hasn't been marked recognized (see below), the button turns **amber** as a soft reminder. You can still advance — it's a reminder, not a lock.
- On the last section, the button reads **Click and Hold for Credits**.
- Tap **← Back** to return to the previous section (or back to the Preamble from section 1).

**Recognition checkboxes:** Each check-in row has a checkbox on the left. Check it after you've acknowledged that station on air. The amber gate on the next-section button clears when all visible check-ins are checked.

---

### FCC ID Timer

The **10:00** countdown in the header tracks time since your last FCC identification. It turns amber at 2 minutes remaining and red at zero. **Tap it** to reset after you ID on air.

---

### Ending the Net

1. Tap **End Net** (or, if using a script, click through to the Credits screen first and tap **End Net** there).
2. A confirmation screen shows total check-ins and unique callsigns.
3. Tap **Confirm End** to close the session and write the final record.

After the net ends, a summary shows:

- Total check-in events
- Unique callsigns
- Total ARES hours (0.5 hours × unique callsigns)
- An **Open Sheet** link to the session log in Google Sheets

Tap **Start new net** to return to the start form for your next session.

---

### Tips for a Fast Net

- The callsign field auto-capitalizes — you don't need Shift.
- Enter key works the same as tapping LOG.
- If a network error occurs, the app retries automatically and shows a toast; don't double-tap.
- If you get kicked back to the Start screen mid-session, the session timed out on the server — tap Start Net again. Check-ins already logged are preserved in the Sheet.

---

---

## Part 2: Attendee (Check-in Station)

**Your role:** You check in to the net over the radio. You don't need the app.

---

### How Check-ins Work

When the NCO calls for check-ins, transmit your callsign clearly. The NCO logs you with three taps or fewer. That's it — your name resolves automatically from the ActivARES roster; you don't need to spell it out unless asked.

**What happens to your information:**

- Your callsign and name are recorded in the net log along with the date, time, and net type.
- You receive 0.5 hours of ARES participation credit per net session, regardless of how many times you check in during that session.
- The EC receives a monthly summary with your participation totals.

**If the NCO asks for your name:** The auto-lookup didn't find you (e.g., you recently licensed, or your callsign changed). Give your name clearly; the NCO will enter it manually.

**If you check in on multiple sections:** The NCO may log your callsign again for each section you respond to. Your tap count goes up, but your hours credit stays at 0.5 for the session.

**Callsign format:** Standard FCC callsign format is required (e.g. `W7ABC`, `KD7XYZ`, portable suffixes like `W7ABC/M` are accepted). Suffix-only entries (`ABC`) are not valid by themselves — the NCO must resolve them to your full callsign.

---

---

## Part 3: Net Manager / Admin (Trustee)

**Your role:** Keep the app configured and running correctly. You are the only user who can create or modify net scripts, and you're responsible for the backend setup.

---

### Initial Setup

Run `setupSheets` (from the Apps Script editor or a trusted Admin trigger) to create all required Sheet tabs:

- `Sessions` — one row per net session
- `Checkins` — one row per check-in event
- `Roster` — the member callsign/name cache populated by Sunday-Sync
- `RosterFallback` — FCC-resolved names for non-roster stations
- `UnknownCallsigns` — pending async lookups
- `MonthlyTotals` — rolled-up participation hours
- `Templates` — net script templates (Admin-only tab; restrict sharing to Admin emails)
- `Repeaters` — repeater system definitions

---

### Managing Repeater Systems

Edit the **Repeaters** tab directly in the Sheet. Each row is one repeater entry. The columns are:

| Column | Purpose |
|---|---|
| `SystemName` | Groups entries into a named system |
| `RepeaterName` | Display name (e.g. `W7YOC 147.260`) |
| `Frequency` | Transmit frequency (e.g. `147.260`) |
| `PlTone` | PL/CTCSS tone |
| `Type` | `primary`, `alternate`, `linked`, or `link` (for EchoLink, AllStar, etc.) |
| `Description` | Shown in the app summary and available as `{{primaryDescription}}` |
| `ClosingCredit` | Text injected into the script `{{repeaterCredit}}` or `{{linkedCredits}}` variable |
| `DisplayOrder` | Sort order within the system for the Tonight's Repeater sub-picker |

After editing, changes appear in the app on the next page load.

---

### Managing Net Scripts

From the **Start Net** screen, tap **Manage Scripts** to open the script editor. The **+ New Script** button and **Save Script** / **Hold to Delete** controls are only visible when you're logged in as an Admin.

#### Creating or editing a script

1. Tap **+ New Script** (or tap an existing script name to edit it).
2. Enter a **Script name**.
3. Write the **Preamble** text — this is read on air at the start of the net. Use the variable chips (blue buttons) to insert placeholders:

| Variable | Resolves to |
|---|---|
| `{{date}}` | Full date, e.g. `Wednesday, May 15, 2026` |
| `{{ncoCallsign}}` | NCO's callsign |
| `{{ncoName}}` | NCO's name (from the start form) |
| `{{ncoLocation}}` | NCO's location |
| `{{netType}}` | Net type entered at start |
| `{{frequency}}` | Tonight's repeater frequency |
| `{{plTone}}` | Tonight's repeater PL tone |
| `{{repeaterName}}` | Tonight's repeater display name |
| `{{repeaterCredit}}` | Tonight's repeater closing credit text |
| `{{primaryName}}` / `{{primaryFrequency}}` etc. | System primary repeater fields |
| `{{alternateNames}}` | Comma-separated alternate repeater names |
| `{{linkedNames}}` | Comma-separated linked repeater names |
| `{{linkedCredits}}` | Linked repeater closing credit lines (newline-separated) |
| `{{echolinkNode}}` | EchoLink node name from the system links |

4. Add **Sections** using **+ Add Section**. Each section has:
   - **Section title** — shown in the progress indicator
   - **Call-to-air text** — the NCO reads this on air; variables are substituted
   - **NCO notes** — private reminders; not substituted, not read on air
   - Use ↑ ↓ buttons to reorder; ✕ to remove a section.

5. Write the **Credits** text — read at the close.
6. Check **Set as default** if this script should pre-select for every new session.
7. Tap **Save Script**. The timestamp and your Google email are recorded as the last editor.

**Deleting a script:** Click and hold **Hold to Delete** for 1.5 seconds. The default script cannot be deleted.

**Parse error badge:** If a script shows `section error` in the list, the `SectionsJson` in the Sheet is malformed. Re-save the script from the editor to repair it.

---

### Sunday-Sync Roster

A time-driven trigger (`sundaySync`) runs weekly (Saturday late) and reads the latest ActivARES roster CSV from the configured Drive folder into the `Roster` tab. If the sync fails, the trustee receives an email.

To update the Drive folder path: edit the `ROSTER_FOLDER_ID` key in `PropertiesService.getScriptProperties()` from the Apps Script project properties panel.

---

### Async Name Resolution

The `asyncResolveUnknowns` trigger runs hourly and looks up pending entries in the `UnknownCallsigns` tab against FCC ULS / HamDB.org. Resolved names are written back into the `Checkins` rows and cached in `RosterFallback` for future sessions. The trigger uses a checkpoint pattern — if it approaches the 6-minute Apps Script limit, it saves progress and resumes on the next run.

---

### Monthly Report

On the 1st of each month at 06:00, the `monthlyReportEmail` trigger totals prior-month participation from the `Checkins` tab (0.5 hours × unique callsigns per session), writes to the `MonthlyTotals` tab, and emails the EC. The EC email address is stored in `PropertiesService.getScriptProperties()` under key `EC_EMAIL`.

---

### Admin Access

Admin status is controlled by the `AdminEmails` property in `PropertiesService.getScriptProperties()` (comma-separated Google email addresses). Only Admin users see:

- The **+ New Script** button in the script editor
- The **Save Script** and **Hold to Delete** controls
- The attribution footer showing who last edited each script

Non-Admin users (including all NCOs) can view scripts but not modify them.

---

*Guide reflects app state as of Slice 4 (2026-05-14). Features coming in future slices include: net type autocomplete, location autocomplete, suffix-tap for non-member stations, timer expiry messaging, and post-net summary flow.*
