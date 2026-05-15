  To exercise it end-to-end in the browser (the design doc's §Verification criteria, condensed):

  1. In the Apps Script editor: function-name dropdown → setupSheets → Run. This creates the new Roster tab in your Sheet (the existing Sessions/Checkins tabs are preserved).
  Logger should say setupSheets: created=["Roster"].
  2. In your Sheet: open the Roster tab and paste these 6 rows (under the header row):

  | Callsign  | Name         | LastActive |
  |-----------|--------------|------------|
  | W7ABC     | (blank)      | (blank)    |
  | KE7ABC    | (blank)      | (blank)    |
  | KE7XYZ    | Darby, Brian | (blank)    |
  | K7TST     | (blank)      | (blank)    |
  | N7DEF     | (blank)      | (blank)    |
  | KH6/W7ABC | (blank)      | (blank)    |

  3. Open the /dev URL (browser signed in as the account that has Editor access to the Sheet — bsdarby@gmail.com from prior smoke test should still work).
  4. Walk the 10-step flow at plans/designs/slice-2-suffix-tap-2026-05-13.md §Verification criteria → Chrome MCP walkthrough. Headline tests: type ABC + LOG → candidate list
  with 3 rows; type XYZ + LOG → one row showing KE7XYZ — Darby, Brian; log KE7XYZ first then XYZ again → "this net" chip on top row; QQQ → no-match message; Escape and Cancel
  both dismiss; full-callsign W7ABC works direct as before.

  Tell me what you see. If anything misbehaves we triage; if it all works, Slice 2 is fully done.