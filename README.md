# Net Control Operations

WashCoARES NCO callsign-only check-in logger. Apps Script web app built with TypeScript and deployed via `clasp`.

This README covers **Slice 1**: the scaffolding and the smallest end-to-end vertical slice (Start Net → log check-ins → End Net → counts written to a Google Sheet). Suffix-Tap UX, roster sync, async FCC resolver, monthly email rollup, PWA / offline, and the rest of the PRD are deferred to subsequent slices. See [`plans/prds/washcoares-nco-checkin-logger-2026-05-12.md`](plans/prds/washcoares-nco-checkin-logger-2026-05-12.md) for the full product spec and [`plans/designs/slice-1-scaffolding-spine-2026-05-12.md`](plans/designs/slice-1-scaffolding-spine-2026-05-12.md) for the Slice 1 design.

## Prerequisites

- Node.js 20 or later. Verify with `node --version`.
- A Google account that can create Apps Script projects and Google Sheets.

## One-time setup

### 1. Install local dependencies

```
npm install
```

This downloads every tool the project uses (TypeScript, esbuild, jest, ESLint, Prettier, clasp) into a local `node_modules/` folder. The folder is gitignored.

### 2. Create the Google-side artifacts

1. Visit [script.google.com](https://script.google.com) and create a new **standalone** Apps Script project. Name it something like "NetControl".
2. In the editor: **Project Settings → Script ID** → copy the value. You'll need it shortly.
3. Visit [drive.google.com](https://drive.google.com) and create a new Google Spreadsheet. This is the durable data store; it does NOT need to be inside the Apps Script project. Copy its **Spreadsheet ID** from the URL (the long string between `/d/` and `/edit`).
4. Decide who should be able to read the Spreadsheet (it's the underlying log). Recommended starting posture: share with the trustee and Emergency Coordinator as Editors; share with the rest of WashCoARES as Viewers if you want NCOs to be able to read the log.
5. Back in the Apps Script editor: **Project Settings → Script Properties → Add property** twice:
   - `SpreadsheetId` = the Spreadsheet ID from step 3.
   - `AdminEmails` = a comma-separated list of Google account emails authorized to run `setupSheets`. **At minimum include your own.** Example: `trustee@example.com,ec@example.com`.

### 3. Wire clasp to your project

```
npx clasp login
cp .clasp.json.example .clasp.json
```

Open `.clasp.json` in an editor and replace `<YOUR_SCRIPT_ID>` with the Script ID from step 2 above. `.clasp.json` is gitignored.

### 4. First push and bootstrap

```
npm run push
```

This builds the TypeScript into `dist/Code.gs`, copies `dist/index.html` and `dist/appsscript.json`, then runs `clasp push`. Reload the Apps Script editor in your browser — you should see `Code.gs`, `index.html`, and `appsscript.json` now appear in the file tree.

In the editor's function picker, select `setupSheets` and click **Run** once. Apps Script will prompt you to authorize the script (consent screen) — accept. After it finishes, open the Spreadsheet — the `Sessions` and `Checkins` tabs are now created with frozen header rows.

### 5. Deploy the web app

```
npm run deploy
```

This pushes (in case anything changed) and creates a new web-app deployment. Copy the deployment URL ending in `/dev` from the output (or look in the Apps Script editor under **Deploy → Test deployments**).

Open that URL in a browser. You should see the Start Net screen.

## Day-to-day development

| Task | Command |
|---|---|
| Edit TypeScript | Use any editor; files live under `src/server/` and `src/html/` |
| Run unit tests | `npm run test` |
| Type-check (no compile output) | `npm run typecheck` |
| Lint | `npm run lint` |
| Auto-format | `npm run format` |
| Build (bundle into `dist/`) | `npm run build` |
| Push to Apps Script | `npm run push` |
| Update an existing deployment in place | `npm run redeploy -- <deploymentId>` |

Run tests and the type-checker before pushing — they catch most mistakes locally so you don't have to learn about them via the Apps Script Execution log.

## Project layout

```
src/server/    TypeScript source (bundled to one dist/Code.gs at build time)
src/html/      HtmlService templates (copied verbatim to dist/)
tests/         jest unit tests with Apps Script global mocks
scripts/       Build-script glue (esbuild + file copies)
plans/         PRDs and design docs
dist/          Build output, gitignored; what clasp actually pushes
```

`appsscript.json` and `.clasp.json.example` live at the repo root. The real `.clasp.json` is gitignored.

## Known limitations (Slice 1)

- **No Suffix-Tap UX.** Callsigns are entered into a plain text input. The thumb-zone keypad is a later slice.
- **No roster lookup.** Slice 1 records the literal callsign string; there's no name resolution.
- **No async FCC resolver.** Unknown callsigns just go into the Sheet by callsign only.
- **No End-Net email to EC, no monthly rollup email.** Counts surface on-screen at End Net only.
- **No undo / edit-on-tap.** Mistakes are corrected by the trustee editing the Sheet directly.
- **No offline mode.** Browser must have network. PWA + IndexedDB are a later slice.
- **Cross-org NCO accountability is weak.** For callers outside the script owner's Google Workspace organization, `Session.getActiveUser().getEmail()` returns empty string — the `NCOEmail` column will be blank. Tightening `appsscript.json`'s `webapp.access` from `ANYONE` to `DOMAIN` (a later slice) fixes this.
- **Page-reload during slow request can create duplicate sessions.** If the NCO closes or reloads the Start tab while `startSession` is in flight, the retry mints a fresh `requestId` and may create a paired duplicate row. Look for two same-minute `Sessions` rows and merge if you see them.
- **No `clasp deploy --deploymentId` round-trip helper.** Each `npm run deploy` creates a NEW versioned deployment, accumulating toward the 20-deployment cap. Use `npx clasp deployments` to list and `npx clasp undeploy <id>` to prune, or use `npm run redeploy -- <existingDeploymentId>` to update one in place.

## Trade-offs you accepted by picking TypeScript

- Source of truth lives locally in this repo, not in the Apps Script editor. You edit here, `npm run push` deploys to Apps Script. Don't edit live in the web editor — it'll be overwritten on the next push.
- One extra build step. `npm run push` (which calls `npm run build` internally) replaces "Ctrl+S in the editor."
- You get: type-checking, unit tests, lint, autoformat. Bugs you'd otherwise discover by deploying-and-trying get caught locally in seconds.
