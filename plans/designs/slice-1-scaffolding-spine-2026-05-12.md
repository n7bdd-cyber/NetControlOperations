# Design Doc: Slice 1 — Scaffolding + Record-a-Check-in Spine

**Date:** 2026-05-12
**Revision:** 2026-05-12 — round 5 (addresses goldfish round 4's 10 residual nits + 3 from round 5: helper return type, startSession network-error retry, revision metadata). Revision response logs at the end of this doc cover rounds 1, 2, 3, and 4.
**Source:** `/eg-new-feature` for [`plans/prds/washcoares-nco-checkin-logger-2026-05-12.md`](../prds/washcoares-nco-checkin-logger-2026-05-12.md)
**Implements PRD FRs:** FR-1 (Start Session), FR-4 (Record Check-in), FR-9 (End Session — Sheet write only; the `MailApp` summary email is deferred).
**Defers PRD FRs:** FR-2, FR-3, FR-5, FR-6, FR-7, FR-8, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, plus PWA / IndexedDB / offline and full WCAG 2.1 AA polish. Note: Slice 1 captures the per-event NCO email and timestamp in the `Checkins` schema so FR-15 (cross-NCO conflict toast) lands in a future slice without a schema migration.

---

## Why

The repo is greenfield — no `package.json`, no `appsscript.json`, no `src/` tree, no tests. Before any FR from the PRD can land in code, the project needs the tooling skeleton (TypeScript + ESLint + Prettier + jest + esbuild + clasp) plus a smallest-possible end-to-end vertical slice that proves the spine works: doGet → Start screen → Logging screen → server records a check-in to a Sheet under LockService → End screen with counts. After Slice 1, future `/eg-new-feature` runs add roster sync, Suffix-Tap UX, async resolver, offline PWA, monthly trigger, and the remaining FRs.

---

## Scope

**In:**
- Project tooling: `package.json`, `tsconfig.json`, `.eslintrc.json`, `.prettierrc.json`, `.prettierignore`, `jest.config.js`, `.gitignore`, `README.md`.
- Build chain: source TypeScript in `src/server/` and `src/html/`; esbuild bundles server TS into a single `dist/Code.gs`; clasp pushes `dist/` to Apps Script. Detailed in §"Build chain" below.
- Apps Script manifest (`appsscript.json`) with V8 runtime, the two OAuth scopes, web-app deployment block (`executeAs: USER_ACCESSING`, `access: ANYONE`), `timeZone: "America/Los_Angeles"` (flagged for user confirmation in Open Questions of the PRD), `exceptionLogging: "STACKDRIVER"`.
- Clasp wiring: `.clasp.json.example` template; real `.clasp.json` is gitignored.
- Source tree: `src/server/`, `src/html/`, `tests/`.
- Sheet schema bootstrap: a one-time `setupSheets` server function that creates `Sessions` and `Checkins` tabs with frozen header rows in the configured Spreadsheet.
- Server functions: `doGet`, `startSession`, `recordCheckin`, `endSession`, `setupSheets`. All callable via `google.script.run`. Idempotency dedup keys (PRD §"Implementation hints") implemented for `startSession` and `recordCheckin`.
- HtmlService template (`src/html/index.html`): single-page with three client-toggled `<section>`s (Start / Logging / End). Plain `<input>` for callsign — no Suffix-Tap yet.
- Jest unit tests for server logic with Apps Script global doubles. No client-side unit tests in Slice 1 (UI verified via Chrome MCP).
- All Sheet writes wrapped in `LockService.getScriptLock().tryLock(10000)`.

**Out (deferred to future slices):**
- Roster tabs and Sunday-Sync trigger (FR-2, FR-11).
- Suffix-Tap candidate-list UX (FR-3) — Slice 1 ships with a plain text `<input>`.
- Unknown-callsign queue + async FCC/HamDB resolver (FR-5, FR-6).
- Undo / edit-on-tap (FR-7, FR-8).
- Backfill count-only (FR-10).
- `MailApp` summary at End Net + monthly trigger (FR-12 + email half of FR-9).
- 5-year purge (FR-13).
- Access-mode toggle UX (FR-14) — Slice 1 ships `access: ANYONE`; tightening to `DOMAIN` is a future redeploy with a manifest change.
- Cross-NCO conflict toast (FR-15) — Slice 1 captures the necessary per-event NCO attribution in the Checkins schema (column I) so this lands without a schema migration.
- Multi-NCO handoff (FR-16).
- PWA, service worker, IndexedDB, offline writes.
- Full WCAG 2.1 AA pass — Slice 1 ships labeled inputs, semantic HTML, ≥48 px tap targets, mobile viewport meta, but does not run an axe / Lighthouse audit.
- Husky / lint-staged pre-commit hooks. Prettier IS in Slice 1 but enforcement is by-hand or by editor for now.
- Client-side jest tests via jsdom. Slice 1 verifies the client via Chrome MCP only.

---

## Build chain (clasp + esbuild)

Apps Script V8 has global scope across `.gs` files and does NOT support ES modules. To keep source code modern and unit-testable, Slice 1 uses esbuild to bundle source modules into a single global-scope `.gs` file, then clasp pushes the bundled output.

**Layout:**
- Source TypeScript: `src/server/*.ts` with normal `import`/`export`. jest imports the same files via `ts-jest` — tests "just work."
- HtmlService: `src/html/*.html`.
- Manifest: `appsscript.json` at repo root.
- Build output: `dist/Code.gs`, `dist/index.html`, `dist/appsscript.json` — all flat at the root of `dist/`. `.clasp.json` lives at the repo root with `"rootDir": "./dist"`.

**esbuild config** (the load-bearing pattern — verified against the Apps Script + esbuild community recipe; if the implementer hits an issue, the canonical alternative is `format: 'cjs'` with a footer that copies `module.exports.*` to `globalThis.*`):

```js
// scripts/build.mjs (the working contract)
import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  outfile: 'dist/Code.gs',
  format: 'iife',
  globalName: '__app__',
  footer: { js: 'for (var k in __app__) { this[k] = __app__[k]; }' },
  target: 'es2020',
  platform: 'neutral',
  charset: 'utf8',
});

await copyFile('src/html/index.html', 'dist/index.html');
await copyFile('appsscript.json', 'dist/appsscript.json');
```

**How the footer works:** esbuild's `format: 'iife'` with `globalName: '__app__'` produces `var __app__ = (() => { ...; return { doGet, startSession, ... }; })();`. The footer then iterates over `__app__`'s keys and assigns each to `this` (which in Apps Script V8 at top-level file scope IS the global object). The result: `doGet`, `startSession`, `recordCheckin`, `endSession`, `setupSheets` are all top-level globals in the deployed script.

`src/server/main.ts` must `export` exactly the five entry-point functions (`doGet`, `startSession`, `recordCheckin`, `endSession`, `setupSheets`) for them to appear on `__app__`. Any internal helper not exported by `main.ts` stays bundled-but-not-globalized.

**npm scripts:**

| Script | Command |
|---|---|
| `npm run build` | `node scripts/build.mjs` |
| `npm run push` | `npm run build && npx clasp push` |
| `npm run deploy` | `npm run push && npx clasp deploy --description "<msg>"` |
| `npm run redeploy` | `npm run push && npx clasp deploy --deploymentId "<id>" --description "<msg>"` (updates an existing deployment in place; avoids accumulating versioned deployments toward the 20-deployment cap) |
| `npm run lint` | `eslint .` |
| `npm run format` | `prettier --write .` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | `jest` |

`scripts/build.mjs` is ~30 lines; specified completely above plus error handling.

---

## Surfaces touched (all NEW — greenfield repo)

| Path | Purpose |
|---|---|
| `package.json` | npm deps + scripts (see §Build chain). Deps: `typescript`, `@types/google-apps-script`, `@types/jest`, `@types/node`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier`, `eslint-config-prettier`, `jest`, `ts-jest`, `esbuild`, `@google/clasp`. All as `devDependencies`. |
| `tsconfig.json` | `target: "ES2020"`; `module: "ESNext"` (for esbuild bundling); `moduleResolution: "Bundler"`; `strict: true`; `esModuleInterop: true`; `types: ["google-apps-script", "node"]`; `include: ["src/**/*", "scripts/**/*"]`; `exclude: ["dist", "node_modules", "tests"]`. |
| `tsconfig.test.json` | Extends `tsconfig.json` with `module: "CommonJS"`, `moduleResolution: "Node"`, `types: ["google-apps-script", "jest", "node"]`, `include: ["src/**/*", "tests/**/*"]`. Used exclusively by jest via ts-jest. |
| `.eslintrc.json` | `@typescript-eslint/recommended` + `eslint-config-prettier`. Disables `no-unused-vars` for type-only declaration files; treats `src/html/` files as browser environment. |
| `.prettierrc.json` | 2-space indent, single quotes, trailing commas (`all`), 100-char line width, semicolons. |
| `.prettierignore` | `dist/`, `node_modules/`, `coverage/`. |
| `jest.config.js` | `testEnvironment: "node"`; `setupFilesAfterEach: ["<rootDir>/tests/setup.ts"]`; `testMatch: ["<rootDir>/tests/**/*.test.ts"]`; `transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] }`. ts-jest reads `tsconfig.test.json` so jest gets CommonJS regardless of the build-side ESNext. **Verify `setupFilesAfterEach` against Jest 29 docs at implementation time**; if the canonical name is `setupFilesAfterEach` (run after framework loads, has jest globals available), keep it; if Jest renamed it, substitute the equivalent. |
| `.gitignore` | `node_modules/`, `dist/`, `coverage/`, `.clasp.json` (real one), `*.log`, `.env`. |
| `README.md` | Local setup steps (see §README content below). |
| `appsscript.json` | See §"`appsscript.json` literal" below. |
| `.clasp.json.example` | `{ "scriptId": "<YOUR_SCRIPT_ID>", "rootDir": "./dist" }`. |
| `scripts/build.mjs` | esbuild bundler + IIFE-strip + template/manifest copy. ~50 lines. |
| `src/server/main.ts` | Entry points: `doGet`, `startSession`, `recordCheckin`, `endSession`, `setupSheets`. Top-level `export function` declarations the build step lifts into Apps Script global scope. |
| `src/server/sheets.ts` | Helpers: `getSpreadsheetOrNull`, `getOrCreateSheetWithHeader`, `appendRowAndGetIndex`, `findRowIndex`, `readRow`, `updateCells`. All lock-aware. |
| `src/server/validators.ts` | `isValidCallsign`, `isValidIsoDate`, `isValidIsoTime`, `clampString`. See §Validators below for exact regex. |
| `src/server/types.ts` | Shared interfaces and column-index enums for the two tabs. |
| `src/server/ids.ts` | `newUuid()` wraps `Utilities.getUuid()`. The wrapper exists because tests substitute a deterministic sequence via a jest module mock; we don't redefine `Utilities` in every test. |
| `src/server/timestamps.ts` | `nowIso()` wraps `new Date().toISOString()` for the same reason — tests can supply a frozen clock. |
| `src/html/index.html` | HtmlService template. See §UX flow. |
| `tests/setup.ts` | Installs Apps Script global doubles. See §Mock shapes below. |
| `tests/sheets.test.ts` | Unit tests for `sheets.ts`. |
| `tests/main.test.ts` | Unit tests for `startSession`, `recordCheckin`, `endSession`, `setupSheets`, `doGet`. |
| `tests/validators.test.ts` | Unit tests for the validators. |

The repo gets these directories: `src/server/`, `src/html/`, `tests/`, `scripts/`. The existing `plans/`, `docs/`, `.claude/` directories are untouched.

---

## `appsscript.json` literal

```json
{
  "timeZone": "America/Los_Angeles",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email"
  ],
  "webapp": {
    "access": "ANYONE",
    "executeAs": "USER_ACCESSING"
  }
}
```

`timeZone` matches the WashCoARES audience (Oregon/Washington). PRD §Open-questions item 3 flags this for user confirmation before commit — the value above is the working assumption pending that confirmation.

No `dependencies`, no `executionApi` block (we don't use `clasp run`), no `urlFetchWhitelist` (no `UrlFetchApp` in Slice 1).

---

## Interfaces

### Server functions (callable from client via `google.script.run`)

All inputs validated server-side. All responses are discriminated unions.

```ts
// In src/server/types.ts

export interface StartSessionInput {
  requestId: string;      // client-generated UUID for idempotency. REQUIRED. PRD "every server function must be safe to call twice with the same arguments."
  date: string;           // "YYYY-MM-DD", required
  time: string;           // "HH:mm" 24h local, required
  netType: string;        // free-text, required, 1..100 chars
  ncoCallsign: string;    // validated, required
  repeater?: string;      // free-text, optional, 0..100 chars
  purposeNotes?: string;  // free-text, optional, 0..500 chars
}

export type StartSessionResult =
  | { ok: true; sessionId: string; deduped: boolean }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

export interface RecordCheckinInput {
  sessionId: string;       // from startSession
  callsign: string;        // ALL-CAPS, validated
  eventId: string;         // client-generated UUID per LOG tap. **IDEMPOTENCY KEY**.
                           // The client MUST reuse the same eventId across retries of the
                           // same LOG tap; a fresh tap mints a fresh eventId. (See §UX Screen 2.)
}

export type RecordCheckinResult =
  | { ok: true; checkinId: string; firstEventForCallsignInSession: boolean; tapCount: number; deduped: boolean }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'INVALID_CALLSIGN' }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'SESSION_CLOSED' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

export interface EndSessionInput {
  sessionId: string;
}

export type EndSessionResult =
  | { ok: true; checkinCount: number; uniqueCallsignCount: number; hoursTotal: number; spreadsheetUrl: string; alreadyClosed: boolean }
  | { ok: false; error: 'INVALID_INPUT'; field: string; reason: string }
  | { ok: false; error: 'SESSION_NOT_FOUND' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' }
  | { ok: false; error: 'NOT_CONFIGURED' };

export type SetupSheetsResult =
  | { ok: true; created: ('Sessions' | 'Checkins')[] }
  | { ok: false; error: 'NOT_CONFIGURED' }
  | { ok: false; error: 'NOT_AUTHORIZED' }
  | { ok: false; error: 'BUSY_TRY_AGAIN' };
```

`hoursTotal` in `EndSessionResult` is `uniqueCallsignCount * 0.5` per PRD §FR-9 (flat-0.5-hours-per-callsign-per-session). Returning it from `endSession` keeps the End-Net screen authoritative without depending on the future monthly-rollup slice.

### Idempotency semantics

- `startSession`: if a `Sessions` row already exists with the same `RequestId`, return its `SessionID` with `deduped: true`. No new row written. `requestId` is validated as a non-empty string of ≤64 characters; format beyond that is not validated (a malicious client gains nothing by sending garbage — it only blows up its own duplicate-detection window).
- `recordCheckin`: idempotency key is the tuple `(sessionId, callsign, eventId)`. If a re-call lands within the lock and the existing `Checkins` row's `LastTappedEventId` equals the incoming `eventId`, return `deduped: true` with the existing `tapCount` — no increment, no timestamp update. Otherwise treat as a fresh event (re-tap). **Using a client-generated UUID per LOG tap (not the wall-clock timestamp) avoids the same-millisecond-tap false-dedup problem and cleanly survives client retries** (the client preserves the same `eventId` across retries; see §UX Screen 2). Note: this diverges from PRD §Implementation hints which suggested `clientTimestamp` as the dedup key; the design's `eventId` is functionally equivalent and strictly more robust.
- `endSession`: if `Sessions.Status == "Closed"`, do NOT overwrite `EndTimestamp` — preserve the original close time. Recompute counts and `hoursTotal` from current `Checkins` rows. Return `alreadyClosed: true`. Empty-session case (zero check-ins) returns `checkinCount: 0, uniqueCallsignCount: 0, hoursTotal: 0` and is valid (an NCO who started a net but had nobody check in is still recorded).

### Sheet column layouts (frozen header rows)

**`Sessions` tab** — one row per net session:

| Col | Header | Type | Notes |
|---|---|---|---|
| A | SessionID | string (UUID) | Primary key from `Utilities.getUuid()` |
| B | StartTimestamp | ISO-8601 UTC | Set by `startSession` server-side |
| C | NetDate | string `YYYY-MM-DD` | From client input |
| D | NetTime | string `HH:mm` | From client input (local time as entered) |
| E | NetType | string | Free-text |
| F | NCOCallsign | string | Validated ALL-CAPS |
| G | NCOEmail | string | From `Session.getActiveUser().getEmail()`; may be empty for cross-org callers |
| H | Repeater | string | Empty if not provided |
| I | PurposeNotes | string | Empty if not provided |
| J | EndTimestamp | ISO-8601 UTC | Empty until `endSession`; preserved on already-closed re-call |
| K | Status | `"Open"` \| `"Closed"` | |
| L | RequestId | string | Idempotency key from `StartSessionInput.requestId` |

**`Checkins` tab** — one row per (session, callsign) pair:

| Col | Header | Type | Notes |
|---|---|---|---|
| A | CheckinID | string (UUID) | Primary key |
| B | SessionID | string (UUID) | FK to `Sessions.SessionID` |
| C | Callsign | string | Validated ALL-CAPS |
| D | FirstTimestamp | ISO-8601 UTC | Server clock at first event; never updated |
| E | LatestTimestamp | ISO-8601 UTC | Server clock at most recent (non-deduped) tap |
| F | TapCount | number | Starts at 1; incremented on re-tap (not on a deduped retry) |
| G | LoggedByNCOEmail | string | NCO email of the *first* event; never updated |
| H | Source | string | Always `"Manual"` in Slice 1. Column present for future Backfill slice; no other value written or tested in Slice 1. |
| I | LastTappedByNCOEmail | string | NCO email of the *most recent* (non-deduped) tap. Updated on each re-tap. **Captured for FR-15 (deferred toast) without a future schema migration.** |
| J | LastTappedEventId | string (UUID) | Client-generated UUID of the most recent (non-deduped) tap. **Idempotency dedup key.** Compared byte-for-byte against incoming `eventId` to detect retries. |

Tap-count semantics: `tapCount` returned to the client is the value AFTER increment (post-increment). The first call returns `tapCount: 1`. The second non-dedup call returns `tapCount: 2`. A deduped retry returns the existing `tapCount` unchanged.

### Header row literals (constants the implementer writes into `setupSheets`)

```ts
// src/server/types.ts
export const SESSIONS_HEADERS = [
  'SessionID', 'StartTimestamp', 'NetDate', 'NetTime', 'NetType',
  'NCOCallsign', 'NCOEmail', 'Repeater', 'PurposeNotes',
  'EndTimestamp', 'Status', 'RequestId',
] as const;

export const CHECKINS_HEADERS = [
  'CheckinID', 'SessionID', 'Callsign', 'FirstTimestamp', 'LatestTimestamp',
  'TapCount', 'LoggedByNCOEmail', 'Source',
  'LastTappedByNCOEmail', 'LastTappedEventId',
] as const;

// Column indexes (0-based for use against getValues()[row] arrays;
// add 1 when calling getRange(row, col) which is 1-based).
export const SessionsCol = {
  SessionID: 0, StartTimestamp: 1, NetDate: 2, NetTime: 3, NetType: 4,
  NCOCallsign: 5, NCOEmail: 6, Repeater: 7, PurposeNotes: 8,
  EndTimestamp: 9, Status: 10, RequestId: 11,
} as const;

export const CheckinsCol = {
  CheckinID: 0, SessionID: 1, Callsign: 2, FirstTimestamp: 3, LatestTimestamp: 4,
  TapCount: 5, LoggedByNCOEmail: 6, Source: 7,
  LastTappedByNCOEmail: 8, LastTappedEventId: 9,
} as const;
```

`setupSheets` writes `SESSIONS_HEADERS` to row 1 of the `Sessions` tab and `CHECKINS_HEADERS` to row 1 of the `Checkins` tab; `setFrozenRows(1)` on each tab. Tests assert on these literals.

---

## UX flow

`doGet(e)` flow:
1. Read `PropertiesService.getScriptProperties().getProperty('SpreadsheetId')`. NO Sheet read.
2. If missing or empty: return `HtmlService.createHtmlOutput('<p>App not configured — contact trustee.</p>').setTitle('NetControl')`.
3. Otherwise: return `HtmlService.createHtmlOutputFromFile('index').setTitle('NetControl')`.

`doGet` never opens the Spreadsheet. The friendly-page branch and the app-shell branch both complete in under 100 ms.

The HtmlService template is fully static — no `<?= ?>` or `<?!= ?>` substitutions. All dynamic content arrives via `google.script.run` responses and is rendered client-side via `textContent` only.

### Screen 1: Start

```
+------------------------------------+
| WashCoARES Net Control             |
| Start a new net                    |
|                                    |
| Net date    [2026-05-12        ]   |  default today (client-local)
| Net time    [19:00             ]   |  default now, HH:mm
| Net type    [Sunday Practice   ]   |  required
| NCO call    [W7ABC             ]   |  required, validated on blur
| Repeater    [W7DTC 146.86      ]   |  optional, 0..100 chars
| Notes       [                  ]   |  optional, multiline, 0..500
|                                    |
|         [  Start Net  ]            |
+------------------------------------+
```

Flow: user fills form → tap `Start Net` → client validates → client generates `requestId = uuid4()` (see polyfill below) and stores it in the `inFlightStart` retry slot → calls `google.script.run.startSession({...input, requestId})` → on success, store `sessionId` in `window.NetControl.sessionId`, clear `inFlightStart`, switch to Logging screen. **Retry semantics mirror the `recordCheckin` LOG-flow contract:** on `withFailureHandler` (network error), one outer retry with the SAME `requestId`, then surface "Network error" toast on second fail. On `{ ok: false, error: 'BUSY_TRY_AGAIN' }`, up to 3 inner retries with 250 / 500 / 1000 ms backoff, same `requestId`. Total of 4 server calls maximum per Start tap.

**`uuid4()` polyfill** (defined inline in the `<script>` block of `index.html`, ~10 lines, used everywhere the client needs a UUID):

```js
function uuid4() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers (pre-Safari 15.4) without crypto.randomUUID.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
}
```

`crypto.getRandomValues` is supported back to IE 11 / iOS 6; covers every NCO phone that can run a modern PWA.

### Screen 2: Logging

```
+------------------------------------+
| W7ABC · Sunday Practice · 19:00    |  header
| 3 check-ins · 3 unique             |  client-side counters
|                                    |
| Callsign  [          ]  [  LOG  ]  |  text input + button
|                                    |
|  Last check-ins:                   |
|  > K7XYZ   19:03  ×1               |
|  > W7DEF   19:02  ×2               |  re-tap shown as ×N
|  > W7GHI   19:01  ×1               |
|                                    |
|              [  End Net  ]         |
+------------------------------------+
```

**Client-side state model** (lives in `window.NetControl`, in-memory only; literal JS `Map` for `checkins`):
```
{
  sessionId: string,
  netType: string, ncoCallsign: string, netTime: string,
  checkins: Map<callsign, {
    checkinId: string,
    firstTimestamp: string,
    latestTimestamp: string,
    tapCount: number,
  }>,
  history: string[],              // ordered list of callsigns in event order, used to render "last 10"
  inFlightStart?: { requestId, input },  // preserved across BUSY_TRY_AGAIN retries
  inFlightCheckin?: { eventId, callsign },  // preserved across retries of one LOG tap
}
```

`history` is a separate ordered list because the same callsign appearing twice should "bubble up" to the top of the visible list on re-tap. Header counts: `checkinCount = sum(checkins[*].tapCount)`, `uniqueCallsignCount = checkins.size`. State is in-memory only; a browser refresh wipes it. The Sheet is the source of truth.

LOG flow:
1. User types callsign, taps LOG (or presses Enter).
2. Client validates format using `isValidCallsign` (same regex as server).
3. **Client generates `eventId = uuid4()` and stores it in `inFlightCheckin`. This `eventId` is reused across ALL retries of this LOG tap.**
4. Client calls `google.script.run.recordCheckin({sessionId, callsign, eventId})` with both success and failure handlers.
5. On `{ ok: true, firstEventForCallsignInSession: true, deduped: false }`: insert into `checkins` map, prepend to `history`, clear `inFlightCheckin`, render.
6. On `{ ok: true, firstEventForCallsignInSession: false, deduped: false }`: update existing `checkins` entry's `tapCount` and `latestTimestamp`, move the callsign to the top of `history`, flash the row briefly, clear `inFlightCheckin`.
7. On `{ ok: true, deduped: true }`: reconcile the client's state to the server's reported `tapCount` (no UI flash; this was a harmless retry).
8. On `{ ok: false, error: 'BUSY_TRY_AGAIN' }`: retry the same call (SAME `eventId` from `inFlightCheckin`) up to 3 times with 250 / 500 / 1000 ms backoff; on all-fail, toast "Try again — system busy" and clear `inFlightCheckin` (user may re-tap if they want, which mints a new `eventId`).
9. On `withFailureHandler` fire (network error before reaching server): one outer retry with the SAME `eventId`, then surface "Network error" toast if still failing. The outer retry budget is 1; subsequent BUSY_TRY_AGAIN inside that retry uses the inner 3-retry budget. Maximum 4 server calls per LOG.
10. On other server errors: toast with the appropriate message; for `SESSION_NOT_FOUND` and `SESSION_CLOSED`, also return to Start screen.
11. Input refocuses after every LOG, error or success.

### Screen 3: End

```
+------------------------------------+
| End net?                           |
|                                    |
|  Sunday Practice · 19:00           |
|  Total check-ins: 12               |
|  Unique callsigns: 11              |
|                                    |
|  [  Confirm End  ]   [  Cancel  ]  |
+------------------------------------+

(after Confirm)

+------------------------------------+
| Net ended.                         |
|                                    |
|  12 check-ins logged.              |
|  11 unique callsigns.              |
|                                    |
|  [ Open Sheet ]  [ Start New Net ] |
+------------------------------------+
```

Confirm → `google.script.run.endSession({sessionId})` → display server-computed counts (NOT client counters, in case of any drift) + `spreadsheetUrl` link returned by `endSession`. "Open Sheet" anchor `href` is set via `textContent`-safe `<a>.href` assignment — the URL is server-trusted because it was composed from the script-property `SpreadsheetId` via `SpreadsheetApp.openById(id).getUrl()`.

**Note on IDOR exposure:** `spreadsheetUrl` includes the Spreadsheet ID. This is intentional per PRD — the "Open Sheet" button is a deliberate feature. Google's ACL on the Spreadsheet itself (the trustee restricts who has access) is the real defense; the URL in the response is harmless to anyone who can't authenticate to the Spreadsheet.

### Visual / CSS spec

Minimal CSS embedded inline in `index.html` (no external stylesheet, no design system in Slice 1):

- Viewport: `<meta name="viewport" content="width=device-width, initial-scale=1">` in `<head>` — required for mobile thumb-zone targets.
- Base font: `system-ui, -apple-system, sans-serif`, 18 px base.
- Tap targets: all `<button>` and clickable elements set to `min-height: 48px; min-width: 48px;`. Form inputs `min-height: 48px;`. Labels and text inputs `font-size: 18px;`.
- Color contrast: dark text (`#111`) on light background (`#fff`); buttons `#0b69d3` on `#fff` (WCAG AA-compliant). Focus ring: `outline: 3px solid #ffbf47; outline-offset: 2px;` on every interactive element.
- Layout: single-column, max-width 480 px, centered. Inputs full-width within the column.
- Toast: position fixed bottom-center, 3-second auto-dismiss, role="alert" for screen readers.
- No CSS framework. ~80 lines of CSS total.

This is the **complete** visual spec for Slice 1. The full WCAG 2.1 AA pass (axe / Lighthouse) is deferred.

---

## OAuth scopes

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email"
]
```

- `https://www.googleapis.com/auth/spreadsheets` — read/write the configured Spreadsheet via `SpreadsheetApp.openById(SpreadsheetId)`. Standalone script (not Sheet-bound), so the full `spreadsheets` scope is required; `.currentonly` does not apply to standalone projects.
- `https://www.googleapis.com/auth/userinfo.email` — `Session.getActiveUser().getEmail()` for per-row NCO accountability. Required for `access: ANYONE` deployments so that cross-Workspace callers' emails are not silently dropped.

**NOT requesting in Slice 1** (added in their owning slices to keep the consent prompt narrow):
- `https://www.googleapis.com/auth/drive.readonly` — for Sunday-Sync CSV reader (FR-11).
- `https://www.googleapis.com/auth/script.send_mail` — for EC email and monthly trigger (FR-12, email half of FR-9).
- `https://www.googleapis.com/auth/script.external_request` — for FCC ULS / HamDB.org resolver (FR-6).

`LockService`, `PropertiesService`, `Utilities.getUuid()`, `ScriptApp.getProjectTriggers()` are built-in Apps Script services that do not require explicit OAuth scopes in the manifest.

### Cross-org `Session.getActiveUser().getEmail()` empty-string behavior

Per Apps Script's documented behavior, `Session.getActiveUser().getEmail()` returns an empty string when the caller is outside the script owner's Google Workspace organization, even with `userinfo.email`. This is a real limitation in Slice 1's `access: ANYONE` deployment:

- The `NCOEmail` / `LoggedByNCOEmail` / `LastTappedByNCOEmail` columns will be empty for cross-org NCOs.
- Per-NCO accountability in Slice 1 effectively rests on `NCOCallsign` (typed by the NCO at Start), which is trivially spoofable.

This is a known **v0 security limitation** that the PRD FR-14 access-mode toggle (deferred) addresses: tightening to `access: DOMAIN` makes the email reliable. Slice 1 accepts the limitation because:
- PRD §FR-14 explicitly ships v0 with `access: ANYONE` and a planned tightening path.
- WashCoARES is a small, trust-based community; the worst case is callsign-typo logs, not adversarial fabrication.
- `LastTappedByNCOEmail` is captured anyway so the future FR-15 cross-NCO conflict toast works the day after FR-14 lands.

This trade-off is surfaced in the README's "Known limitations" section.

---

## State management

- **Persistent state** lives in the bound Spreadsheet (Sessions + Checkins tabs).
- **`SpreadsheetId`** in `PropertiesService.getScriptProperties()` under that exact key. Set **once during admin install** by the trustee, via the **Apps Script editor UI**: Project Settings → Script Properties → Add property → key `SpreadsheetId`, value the Spreadsheet ID. **No `setSpreadsheetId` server function is shipped in Slice 1** — exposing it via `google.script.run` would let any caller of an `access: ANYONE` web app re-target the Sheet. The Properties UI is gated by Apps Script project ownership, which is the right gate.
- **`AdminEmails`** in `PropertiesService.getScriptProperties()` — a comma-separated list of email addresses authorized to invoke `setupSheets`. Set during install via the same Properties UI. **Parsing:** split on `,`, trim whitespace from each entry, lowercase. Compare `Session.getActiveUser().getEmail().toLowerCase()` against the resulting list. If the caller's email is an empty string (cross-org caller), the comparison fails and the caller is denied — empty strings are NEVER a match, even if `AdminEmails` happens to contain an empty token. If `AdminEmails` is empty, missing, or contains only empty tokens, **`setupSheets` returns `NOT_AUTHORIZED` to every caller** — including `google.script.run` callers. The trustee adds their own email here so they can call `setupSheets` once.
- **No `UserProperties`** in Slice 1 — no per-NCO server-side state.
- **No `DocumentProperties`** — script is standalone, not bound to any document.
- **No `CacheService`** in Slice 1. Future slices may cache the roster snapshot.
- **Client-side state** lives only in `window.NetControl` (in-memory). No localStorage / IndexedDB / sessionStorage in Slice 1.

---

## Concurrency

All Sheet write paths (`startSession`, `recordCheckin`, `endSession`, `setupSheets`) acquire `LockService.getScriptLock().tryLock(10000)` (10-second timeout) before any read or write inside the function, and release the lock in a `finally` block.

**Why `getScriptLock` and not `getUserLock` / `getDocumentLock`:** the Sheet is the shared resource. Concurrent NCO writes (handoff scenarios, future) and the future trigger writes (Sunday-Sync, async resolver, monthly rollup) all need cross-user / cross-execution serialization. `getUserLock` only serializes a single user against themselves; `getDocumentLock` requires a script bound to a document (we're standalone). `getScriptLock` is the correct choice.

**Lock contention failure:** if `tryLock(10000)` returns false, the server function returns `{ ok: false, error: 'BUSY_TRY_AGAIN' }`. Client retries the same call (same `requestId` / same `eventId`, so retries are idempotent) up to 3 times with 250 / 500 / 1000 ms backoff. On all-fail, the client surfaces a non-blocking toast. **Total retry budget for a single LOG tap: at most one outer network-error retry, plus up to 3 inner BUSY_TRY_AGAIN retries — 4 server calls maximum.**

**Lock release on exception:** every server function wraps its lock acquisition in a `try { ... } finally { lock.releaseLock(); }` block. An uncaught exception inside the function still releases the lock. Tests assert this (see §Verification).

**Idempotency-aware `recordCheckin` flow:**

Step 0 (BEFORE lock, fail fast on bad input): validate `sessionId`, `callsign`, `eventId` per §Server-side input policy; reject with `INVALID_INPUT` or `INVALID_CALLSIGN`.

Step 1 (inside `withLock`):

0. Call `getSpreadsheetOrNull()` — if null, return `NOT_CONFIGURED`. Then `getSheetOrNull(ss, 'Sessions')` and `getSheetOrNull(ss, 'Checkins')` — if either is null, return `NOT_CONFIGURED`.
1. Read `Sessions` row by `SessionID`. Reject `SESSION_NOT_FOUND` or `SESSION_CLOSED`.
2. Read `Checkins` and find the row matching both `SessionID` and `Callsign`.
3. **Dedup check:** if such a row exists AND `row[CheckinsCol.LastTappedEventId] === eventId`, return `{ ok: true, deduped: true, firstEventForCallsignInSession: false, tapCount: existing.TapCount, checkinId: existing.CheckinID }`. No write.
4. Else if matching row exists: increment `TapCount`, set `LatestTimestamp = nowIso()`, set `LastTappedEventId = eventId`, set `LastTappedByNCOEmail = currentEmail`. Return `{ ok: true, deduped: false, firstEventForCallsignInSession: false, tapCount: new TapCount, checkinId: existing.CheckinID }`.
5. Else (no matching row): append a new row with `FirstTimestamp = LatestTimestamp = nowIso()`, `LastTappedEventId = eventId`, `LoggedByNCOEmail = LastTappedByNCOEmail = currentEmail`, `TapCount = 1`, `Source = "Manual"`. Return `{ ok: true, deduped: false, firstEventForCallsignInSession: true, tapCount: 1, checkinId: newId }`.

The `eventId` UUID dedup is robust under three otherwise-fragile concurrent scenarios: same-millisecond taps (different UUIDs), retries (client preserves the same UUID), and cross-org callers with empty emails (UUID is the entire key, email is not consulted for dedup).

**Idempotency-aware `startSession` flow:**

Step 0 (before lock): validate every required input field per §Server-side input policy; reject `INVALID_INPUT` for empty/malformed `requestId`, `date`, `time`, `netType`, `ncoCallsign`.

Step 1 (inside `withLock`):

0. Call `getSpreadsheetOrNull()` — if null, return `NOT_CONFIGURED`. Then `getSheetOrNull(ss, 'Sessions')` — if null, return `NOT_CONFIGURED`.
1. Scan `Sessions.RequestId` for the incoming `requestId`. If found, return `{ ok: true, sessionId: existing, deduped: true }`. No write.
2. Else append a new `Sessions` row (writing `requestId` into the `RequestId` column), return `{ ok: true, sessionId: newId, deduped: false }`.

**Explicit `endSession` flow:**

Step 0 (before lock): validate `sessionId` (non-empty string ≤64 chars) per §Server-side input policy; reject `INVALID_INPUT` if violated.

Step 1 (inside `withLock`; mirrors `recordCheckin`):

0. Call `getSpreadsheetOrNull()` — if null, return `NOT_CONFIGURED`. Then `getSheetOrNull(ss, 'Sessions')` and `getSheetOrNull(ss, 'Checkins')` — if either null, return `NOT_CONFIGURED`.
1. Read `Sessions` row by `SessionID`. If missing, return `SESSION_NOT_FOUND`.
2. Scan `Checkins` for all rows where `SessionID` matches. Compute: `checkinCount = sum(rows[*].TapCount)` (total tap events — matches the client's running header counter), `uniqueCallsignCount = rows.length` (one row per unique callsign by construction), `hoursTotal = uniqueCallsignCount * 0.5` (PRD FR-9 flat-0.5 per unique participant).
3. If `Sessions.Status === "Closed"`: return `{ ok: true, ...counts, alreadyClosed: true }`. Do NOT overwrite `EndTimestamp`.
4. Else: set `Sessions.Status = "Closed"`, set `Sessions.EndTimestamp = nowIso()`, return `{ ok: true, ...counts, alreadyClosed: false }`.

(`checkinCount` semantics: chosen as `sum(TapCount)` so the End-Net display "4 check-ins logged" matches what the NCO actually tapped during the net, including re-taps. `uniqueCallsignCount` separately reports the number of distinct people. PRD §FR-9 ships hours as `uniqueCallsignCount * 0.5` per the flat-0.5-per-person rule.)

**Admin-gated `setupSheets` flow:**
1. **First, outside the lock**, read `Session.getActiveUser().getEmail()` and check against `AdminEmails`. If unauthorized, return `NOT_AUTHORIZED` immediately. This avoids holding the lock while denying anonymous traffic.
2. Acquire the lock via `withLock`. Inside:
   - Call `getSpreadsheetOrNull()`. If null, return `NOT_CONFIGURED`.
   - Call `getOrCreateSheetWithHeader(ss, 'Sessions', SESSIONS_HEADERS)` and `getOrCreateSheetWithHeader(ss, 'Checkins', CHECKINS_HEADERS)`.
   - Build the `created: ('Sessions' | 'Checkins')[]` list reflecting which were newly created vs. already existed.
   - `Logger.log("setupSheets: created=[<list>] existed=[<list>] for <caller email>")`.
   - Return `{ ok: true, created }`.

**eventId scope:** `eventId` is unique-per-LOG-tap, but the dedup compare is scoped to a `(sessionId, callsign)` pair — the implementer should NOT treat `eventId` as a global key across the session. A buggy client that reuses the same `eventId` across different callsigns produces independent rows (correct per-row dedup; no false collapse). Conversely, a fresh `eventId` for a re-tap of the same callsign is treated as an authentic re-tap (the desired behavior).

**Lock duration target:** ≤500 ms per call under normal load. `tryLock(10000)` is the safety margin (20× target).

---

## Apps Script execution budget

| Function | Typical | Worst case | Budget concern? |
|---|---|---|---|
| `doGet` | <100 ms (no Sheet read) | <500 ms | No |
| `setupSheets` | <2 s (creates 2 tabs) | <5 s | No |
| `startSession` | <500 ms (one scan + one append) | <1 s | No |
| `recordCheckin` | <1 s (one scan + one update or append) | <2 s at year-5 scale | No |
| `endSession` | <1 s (one scan + one update) | <2 s | No |

`doGet` performs zero Sheet reads — it only reads `PropertiesService.getScriptProperties()` (single key lookup, sub-millisecond) before branching to the friendly page or the template. This means many concurrent page loads do not amplify the LockService contention against the writers.

The scan inside `recordCheckin` is O(rows-in-`Checkins`) plus O(rows-in-`Sessions`) — at year-5 scale (~13k Checkins rows; ~1.3k Sessions rows), this is ~30 ms of Sheet API time — well within the 1 s typical budget. Both scans are linear; combined cost dominated by `Checkins`. Better-than-linear lookups (CacheService-backed per-session callsign index) are an explicit Out-of-scope follow-up.

No checkpoint/resume needed in Slice 1.

---

## HtmlService rendering

- **No data injection via templates.** The HtmlService template (`src/html/index.html`) is fully static — no `<?= ?>`, no `<?!= ?>`. All dynamic content comes from `google.script.run` responses and is rendered client-side via DOM `textContent` assignment (or, for the "Open Sheet" anchor's `href`, by setting `.href` directly with the server-trusted URL string).
- **No inline event handlers.** All listeners are attached via `addEventListener` in a single `<script>` block at the bottom of the template.
- **No `setXFrameOptionsMode` call.** The Apps Script HtmlService default sandboxing (V8 IFRAME mode) is correct as-is; setting `XFrameOptionsMode.DEFAULT` is a no-op (and the constant is deprecated). Slice 1 omits the call.
- **Viewport meta tag** in `<head>`: `<meta name="viewport" content="width=device-width, initial-scale=1">`. Required for the ≥48 px tap targets to render at the intended physical size on mobile.
- **No CSP nonce machinery.** Apps Script's iframe sandbox handles CSP for us.

---

## Failure modes

| Failure | What the user sees | Code path |
|---|---|---|
| `SpreadsheetId` script property not set | `doGet` renders `<p>App not configured — contact trustee.</p>`. All other server functions return `{ ok: false, error: 'NOT_CONFIGURED' }`. | `getSpreadsheetOrNull()` returns null if the property is empty; callers convert null to `NOT_CONFIGURED`. |
| Configured Spreadsheet deleted / no access | Same friendly page when discovered on first server function call; `SpreadsheetApp.openById` throws `Exception: Requested entity was not found`. | Try/catch around `openById`; converted to `NOT_CONFIGURED`. |
| Sessions / Checkins tab missing | Server functions return `NOT_CONFIGURED`; `Logger.log` records `"Run setupSheets() first"` for trustee diagnostics. | Runtime functions call `getSheetOrNull` (read-only) and return `NOT_CONFIGURED` when it returns null. Only `setupSheets` calls `getOrCreateSheetWithHeader` to actually create tabs. |
| Lock contention | Client toast: "Try again — system busy." | `tryLock(10000)` returns false → `BUSY_TRY_AGAIN` → client retries 3× with backoff, then surfaces. |
| Invalid callsign at client | Inline error under the input: "Callsigns are letters, digits, and `/` only (e.g. W7ABC, K7XYZ/M)." LOG button disabled until valid. | `isValidCallsign` runs on `input` event. |
| Invalid callsign at server (defense in depth) | Client toast: "Invalid callsign." | Server validates again; returns `INVALID_CALLSIGN`. |
| Unknown `sessionId` | Client toast: "Session expired — start a new net." Returns to Start screen. | `SESSION_NOT_FOUND`. |
| Logging to a `Closed` session | Same toast as above. | `SESSION_CLOSED`. |
| OAuth scope denied at consent | Apps Script's own error page; user re-authenticates and re-grants. | Out of our control. |
| `Session.getActiveUser().getEmail()` empty (cross-org "anyone" access) | Empty string is stored in `NCOEmail` / `LoggedByNCOEmail` / `LastTappedByNCOEmail`. No row is rejected. Accountability degrades to `NCOCallsign`-only. | Documented v0 limitation; mitigated when FR-14 toggles to `DOMAIN`. |
| Network error mid-call | Client `withFailureHandler` toast "Network error — retrying." Retries the call once with the same `requestId` / `eventId`, then surfaces on second fail. | `google.script.run.withFailureHandler(...)`. |
| Concurrent same-callsign LOG from different NCOs | Lock serializes; second writer hits the existing-row branch and increments tap count, updates `LastTappedByNCOEmail`. No data loss; the cross-NCO toast (FR-15) is deferred but the data captured here makes it possible. | First-write-wins lock pattern above. |

---

## Validators

Exact regex (`src/server/validators.ts`):

```ts
// Callsign: 2-7 ALL-CAPS alphanumeric, optional /SUFFIX of 1-5 ALL-CAPS alphanumeric.
// Accepts: W7ABC, KE7XYZ, W7ABC/M, W7ABC/MM, W7ABC/QRP, K7XYZ/AE, KH6/W7ABC, W7ABC/3
// Rejects: empty, single char, lowercase, special chars other than `/`, >12 chars total,
//          starts or ends with `/`, multiple `/`.
const CALLSIGN_RE = /^[A-Z0-9]{2,7}(?:\/[A-Z0-9]{1,5})?$/;

export function isValidCallsign(s: string): boolean {
  return typeof s === 'string' && s.length <= 12 && CALLSIGN_RE.test(s);
}

// ISO date: YYYY-MM-DD strict regex, with month 01-12 and day 01-31. Does NOT validate
// calendar (so 2026-02-30 passes — acceptable for Slice 1; future slice can add real date math).
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidIsoDate(s: string): boolean {
  return typeof s === 'string' && DATE_RE.test(s);
}

// ISO time: HH:mm, 00-23 : 00-59. No seconds.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidIsoTime(s: string): boolean {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function clampString(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max);
}
```

The callsign regex is intentionally permissive — accepts FCC US callsigns plus common portable indicators (`/M`, `/MM`, `/P`, `/AM`, `/AE`, `/AG`, `/QRP`, `/N`, `/3`...) and prefix-portable forms (`KH6/W7ABC`). It rejects clearly-invalid input (lowercase, special chars, single char, too long). Strict per-country FCC validation is out of scope; the resolver will catch typos in a future slice.

### Server-side input policy

- `clampString(value, max)` — if `value.length > max`, the server **silently truncates** to `max` chars and logs via `Logger.log` so the trustee can audit. The server does NOT reject for length; the client-side validators reject. Server-side defense in depth is "clamp, don't crash."
- `requestId` and `eventId` — required, validated as non-empty strings of ≤64 characters. Format beyond non-empty is not validated (a malicious client only blows up its own duplicate-detection window).
- `sessionId` (passed to `recordCheckin` and `endSession`) — validated as a non-empty string ≤64 chars. The server does NOT format-validate as a UUID; the lookup-or-fail path (`SESSION_NOT_FOUND`) is the real gate.
- Required-string fields (`netType`, `ncoCallsign`, `date`, `time`): empty / whitespace-only is `INVALID_INPUT`. Format-validate `date` and `time` against the regex; `ncoCallsign` against the callsign regex. `netType` accepts any 1-100-char string.
- Optional strings (`repeater`, `purposeNotes`): empty string is fine; non-empty is clamped at the documented length.

### Client-side validator inline error text

Rendered as `<p class="field-error">` under the corresponding input, visible only when the input is `:invalid` or the client validator returns false:

| Field | Error text |
|---|---|
| `date` | "Date must look like 2026-05-12." |
| `time` | "Time must look like 19:00 (24-hour)." |
| `netType` | "Net type is required (max 100 chars)." |
| `ncoCallsign` | "Callsigns are letters, digits, and `/` only (e.g. W7ABC, K7XYZ/M)." |
| `repeater` | "Repeater max 100 chars." |
| `purposeNotes` | "Notes max 500 chars." |
| (Logging-screen callsign input) | "Callsigns are letters, digits, and `/` only (e.g. W7ABC, K7XYZ/M)." |

---

## Server helper signatures

For `src/server/sheets.ts` — exact signatures the implementer will write:

```ts
// Returns null when SpreadsheetId is unset, empty, or points to a Sheet the script
// cannot open. Catches the openById exception internally. Does NOT acquire a lock —
// callers must hold the script lock if they intend to write.
export function getSpreadsheetOrNull(): GoogleAppsScript.Spreadsheet.Spreadsheet | null {
  const id = PropertiesService.getScriptProperties().getProperty('SpreadsheetId');
  if (!id) return null;
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    Logger.log(`getSpreadsheetOrNull: openById failed: ${e}`);
    return null;
  }
}

// Returns the named sheet if present, or null. Read-only — does NOT create.
// Used by runtime paths (startSession, recordCheckin, endSession) that should refuse
// with NOT_CONFIGURED rather than auto-bootstrapping. Caller holds the script lock.
export function getSheetOrNull(
  ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
  name: string,
): GoogleAppsScript.Spreadsheet.Sheet | null;

// Idempotent: returns existing sheet if present (data preserved, headers NOT rewritten);
// creates with the given header row and `setFrozenRows(1)` if absent. The `created` flag
// in the return value tells the caller whether a NEW sheet was created (true) or an
// existing one was returned untouched (false) — used by setupSheets to build the
// `SetupSheetsResult.created: string[]` list. Used ONLY by `setupSheets`. Caller holds the script lock.
export function getOrCreateSheetWithHeader(
  ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
  name: string,
  headers: readonly string[],
): { sheet: GoogleAppsScript.Spreadsheet.Sheet; created: boolean };

// Appends row, returns the 1-indexed row number (computed via `sheet.getLastRow()`
// after the append, NOT `appendRow`'s void return). Caller holds the script lock.
export function appendRowAndGetIndex(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  values: readonly unknown[],
): number;

// Linear scan over getDataRange().getValues() starting at row 2 (skipping header).
// Returns 1-indexed sheet row when predicate is true; -1 otherwise. Caller holds the
// script lock. Used for both single-key lookups (predicate = (row) => row[col] === id)
// and composite-key lookups (predicate = (row) => row[c1] === a && row[c2] === b).
export function findRowIndex(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  predicate: (row: unknown[]) => boolean,
): number;

// Reads the row's values at the 1-indexed row, returns the unknown[] of cell values.
// Caller holds the script lock.
export function readRow(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rowIndex: number,
): unknown[];

// Writes one or more cells in the row. `updates` is a sparse object keyed by column
// number (1-indexed). Caller holds the script lock.
export function updateCells(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rowIndex: number,
  updates: Record<number, unknown>,
): void;
```

**`withLock<T>` helper** — declared in `src/server/sheets.ts` alongside the other helpers:

```ts
// Returns the function's result, OR the literal string 'BUSY' if tryLock(10000) failed.
// Releases the lock in finally — exceptions inside fn() propagate AFTER the lock is released.
export function withLock<T>(fn: () => T): T | 'BUSY';
```

Every write-path function (`startSession`, `recordCheckin`, `endSession`, the post-auth body of `setupSheets`) wraps its body in `withLock(() => { ... })` and converts a `'BUSY'` result to `{ ok: false, error: 'BUSY_TRY_AGAIN' }`. This single helper is where the lock-release-on-exception behavior lives — the per-function release-on-exception tests verify the helper-level guarantee via spy assertions on `releaseLock`.

---

## Time-zone and field semantics

- `appsscript.json.timeZone = "America/Los_Angeles"` — affects only what `Utilities.formatDate(date, tz, ...)`-style calls return when called server-side. The Slice 1 server code does NOT use `Utilities.formatDate`; it uses `new Date().toISOString()` (always UTC) for all server-clock timestamps (`StartTimestamp`, `EndTimestamp`, `FirstTimestamp`, `LatestTimestamp`).
- `NetDate` and `NetTime` are **client-entered opaque strings, in the local time zone of whoever fills in the Start form**. The server validates format but does not interpret. The future monthly-rollup slice (FR-12) will need to interpret these for date-bucketing; the design there will need to either (a) require the client to send a tz-aware ISO datetime in addition, or (b) bucket by `StartTimestamp` UTC + a known display tz. Captured as Out-of-scope follow-up; Slice 1 stores the strings as entered.

## `webapp.access` value

`appsscript.json` sets `"access": "ANYONE"`, which means **the caller must be signed in to a Google account** (any account, any organization). `Session.getActiveUser().getEmail()` then returns the caller's email for callers within the script owner's Workspace, and empty string for cross-org callers (the documented limitation). The alternative `"ANYONE_ANONYMOUS"` would not require sign-in at all and would always return empty email; Slice 1 does NOT use it because we want at least the Google account identity even cross-org.

---

## Mock shapes (`tests/setup.ts`)

The Apps Script global doubles installed for jest. Minimal API surface — only what the server code calls.

```ts
// tests/setup.ts (shape; exact code in implementation step)

interface MockSheet {
  getName(): string;
  getRange(row: number, col: number, numRows?: number, numCols?: number): MockRange;
  getLastRow(): number;
  appendRow(values: unknown[]): void;
  getDataRange(): MockRange;
  setFrozenRows(n: number): void;
}

interface MockRange {
  getValues(): unknown[][];
  setValues(values: unknown[][]): void;
  setValue(value: unknown): void;
}

interface MockSpreadsheet {
  getId(): string;
  getUrl(): string;
  getSheetByName(name: string): MockSheet | null;
  insertSheet(name: string): MockSheet;
}

// Globals installed on globalThis before each test (setupFilesAfterEach):
globalThis.SpreadsheetApp = {
  openById: jest.fn((id: string) => /* returns the in-memory mock spreadsheet */),
};

globalThis.Session = {
  getActiveUser: jest.fn(() => ({ getEmail: jest.fn(() => testEmail) })),
};

globalThis.LockService = {
  getScriptLock: jest.fn(() => ({
    tryLock: jest.fn((ms: number) => mockLockAvailable),  // controlled per-test
    releaseLock: jest.fn(),
  })),
};

globalThis.PropertiesService = {
  getScriptProperties: jest.fn(() => ({
    getProperty: jest.fn((key: string) => mockProps[key] ?? null),
    setProperty: jest.fn((key: string, value: string) => { mockProps[key] = value; }),
  })),
};

globalThis.Utilities = {
  getUuid: jest.fn(() => mockUuidSequence.shift() ?? 'fallback-uuid'),
};

globalThis.HtmlService = {
  createHtmlOutput: jest.fn((html: string) => ({ setTitle: jest.fn().mockReturnThis() })),
  createHtmlOutputFromFile: jest.fn((name: string) => ({ setTitle: jest.fn().mockReturnThis() })),
};

globalThis.Logger = {
  log: jest.fn(),
};
```

Mock fixture detail: `MockSpreadsheet.getUrl()` returns the literal string `https://docs.google.com/spreadsheets/d/MOCK_SPREADSHEET_ID/edit` so `endSession` tests can assert on `spreadsheetUrl` deterministically. `MockSpreadsheet.getId()` returns `MOCK_SPREADSHEET_ID`. Both are constants exported from `tests/setup.ts`.

Test helpers exposed in `tests/setup.ts`:
- `setLockAvailable(boolean)` — controls what `tryLock` returns. Tests that need contention call `setLockAvailable(false)`.
- `setMockUuids(strings: string[])` — primes a deterministic UUID sequence consumed by `Utilities.getUuid()`.
- `setMockNowIso(string)` — primes the next return value of the `timestamps.nowIso()` helper. The setter sets a single fixed value (subsequent `nowIso()` calls return that value until reset). For tests needing a sequence, call `setMockNowIso` again before each phase.
- `setMockEmail(string)` — sets what `Session.getActiveUser().getEmail()` returns.
- `setMockSpreadsheetId(string | null)` — sets the `SpreadsheetId` property.
- `setMockAdminEmails(string | null)` — sets the `AdminEmails` property.
- `resetMocks()` — clears state between tests. **Lifecycle: registered as `beforeEach(resetMocks)` at the top of `tests/setup.ts`** so every test starts with a known-clean state (including the very first test). `resetMocks` also calls `jest.clearAllMocks()` to reset call counts.

The mock Spreadsheet is a small in-memory store with a `Map<sheetName, row[][]>` backing each tab.

---

## Verification criteria

### Jest unit tests (file → test names)

**`tests/validators.test.ts`:**
- `isValidCallsign — accepts W7ABC, KE7XYZ, W7ABC/M, W7ABC/P, W7ABC/MM, W7ABC/QRP, KH6/W7ABC, K7XYZ/3`
- `isValidCallsign — rejects empty string, single char (W), lowercase (w7abc), special chars (W7@BC), trailing slash (W7ABC/), leading slash (/W7ABC), double slash (W7ABC//M), >12 chars`
- `isValidIsoDate — accepts 2026-05-12, 2026-01-01, 2026-12-31`
- `isValidIsoDate — rejects 2026/05/12, 2026-5-12, 2026-13-01, 2026-00-15, 2026-05-32, "today"`
- `isValidIsoTime — accepts 19:00, 00:00, 23:59`
- `isValidIsoTime — rejects 7:00 PM, 24:00, 19:60, 19:00:00, ""`
- `clampString — returns "" for undefined, returns s for short s, truncates long s to max chars`

**`tests/sheets.test.ts`:**
- `getSpreadsheetOrNull — returns null when SpreadsheetId property unset`
- `getSpreadsheetOrNull — returns null when openById throws`
- `getSpreadsheetOrNull — returns the mock Spreadsheet when SpreadsheetId is set and openable`
- `getSheetOrNull — returns the sheet when present`
- `getSheetOrNull — returns null when absent (does NOT create)`
- `getOrCreateSheetWithHeader — returns existing sheet when present`
- `getOrCreateSheetWithHeader — creates sheet with frozen header row when absent`
- `getOrCreateSheetWithHeader — does NOT modify an existing sheet's header or data`
- `appendRowAndGetIndex — writes the row and returns the new 1-indexed row position`
- `findRowIndex — returns the 1-indexed row when found by composite key (SessionID, Callsign)`
- `findRowIndex — returns -1 when not found`
- `updateCells — writes new values into the given (row, col) cells`
- `withLock — calls fn() and returns its result on lock success; releases lock in finally`
- `withLock — returns 'BUSY' when tryLock returns false; fn is NOT called`
- `withLock — releases lock even when fn() throws (exception propagates)`

**`tests/main.test.ts`:**
- `doGet — returns the friendly "App not configured" output when SpreadsheetId property is missing`
- `doGet — returns the index.html output when SpreadsheetId is set (does NOT open the Spreadsheet)`
- `setupSheets — creates both tabs with correct headers (asserted against SESSIONS_HEADERS and CHECKINS_HEADERS constants) and frozen row 1 on a fresh Spreadsheet`
- `setupSheets — is idempotent: when both tabs already exist with data, re-running returns created: [], headers row 1 unchanged, and ALL pre-existing data rows in rows 2+ are byte-identical to before`
- `setupSheets — returns NOT_CONFIGURED if SpreadsheetId missing`
- `setupSheets — returns NOT_AUTHORIZED if caller email not in AdminEmails CSV`
- `setupSheets — returns NOT_AUTHORIZED if AdminEmails is empty / unset`
- `setupSheets — succeeds when caller email IS in AdminEmails`
- `setupSheets — calls Logger.log with a human-readable confirmation that the trustee will see in the editor's Execution log`
- `startSession — writes a Sessions row with all required fields (including RequestId column populated from input), returns a UUID, deduped: false`
- `startSession — re-call with the same requestId returns the existing sessionId, deduped: true, writes NO new row (verified via spy on appendRowAndGetIndex)`
- `startSession — rejects missing ncoCallsign with INVALID_INPUT (field: "ncoCallsign")`
- `startSession — rejects invalid date format with INVALID_INPUT (field: "date")`
- `startSession — rejects invalid time format with INVALID_INPUT (field: "time")`
- `startSession — rejects empty requestId with INVALID_INPUT (field: "requestId")`
- `startSession — rejects requestId longer than 64 chars with INVALID_INPUT`
- `startSession — clamps netType > 100 chars; row written with truncated value, no error`
- `startSession — returns NOT_CONFIGURED when SpreadsheetId is unset (no append attempted)`
- `startSession — returns NOT_CONFIGURED when Sessions tab is missing`
- `recordCheckin — fresh session, new callsign: creates Checkins row, returns firstEventForCallsignInSession: true, tapCount: 1, deduped: false; row has FirstTimestamp = LatestTimestamp = nowIso, LastTappedEventId = eventId, LoggedByNCOEmail = LastTappedByNCOEmail = caller, Source = "Manual"`
- `recordCheckin — same callsign, different eventId: second call returns firstEventForCallsignInSession: false, tapCount: 2, deduped: false; FirstTimestamp unchanged; LatestTimestamp updated; LastTappedEventId updated; LastTappedByNCOEmail updated to second caller`
- `recordCheckin — same callsign, SAME eventId: returns deduped: true, tapCount unchanged, NO row write (verified via spy on updateCells / appendRowAndGetIndex)`
- `recordCheckin — closed session: returns SESSION_CLOSED`
- `recordCheckin — unknown sessionId: returns SESSION_NOT_FOUND`
- `recordCheckin — returns NOT_CONFIGURED when SpreadsheetId is unset`
- `recordCheckin — returns NOT_CONFIGURED when Checkins tab is missing`
- `recordCheckin — invalid callsign: returns INVALID_CALLSIGN`
- `recordCheckin — empty eventId: returns INVALID_INPUT, field: "eventId"`
- `recordCheckin — eventId longer than 64 chars: returns INVALID_INPUT`
- `recordCheckin — lock contention (setLockAvailable(false)): returns BUSY_TRY_AGAIN`
- `recordCheckin — exception thrown inside the lock (mock Sheet to throw): lock is released (releaseLock spy called) before the exception propagates`
- `startSession — exception thrown inside the lock: lock is released before exception propagates`
- `endSession — exception thrown inside the lock: lock is released before exception propagates`
- `setupSheets — exception thrown inside the lock: lock is released before exception propagates`
- `endSession — flips Status to Closed, fills EndTimestamp, returns checkinCount, uniqueCallsignCount, hoursTotal = unique × 0.5, spreadsheetUrl, alreadyClosed: false`
- `endSession — zero check-ins (no Checkins rows): returns counts both 0, hoursTotal: 0, alreadyClosed: false, Status flips to Closed`
- `endSession — already-closed session: returns alreadyClosed: true, does NOT overwrite EndTimestamp, returns recomputed counts and hoursTotal`
- `endSession — unknown sessionId: returns SESSION_NOT_FOUND`
- `endSession — empty sessionId: returns INVALID_INPUT (field: "sessionId")`
- `endSession — returns NOT_CONFIGURED when SpreadsheetId is unset`
- `endSession — checkinCount equals sum of TapCounts across this session's Checkins rows (re-tap contributes to the count)`

### Tooling gates
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run test` all green.
- `npm run build` produces `dist/Code.gs`, `dist/index.html`, `dist/appsscript.json` with no errors.

### Live-deployment manual verification (Chrome MCP against the deployed test URL)

Prerequisites: trustee has run `npm install`, `npm run build`, `npx clasp login`, `npm run push`, `npm run deploy`, copied the resulting `/dev` URL, and manually set BOTH the `SpreadsheetId` AND `AdminEmails` script properties via the Apps Script editor → Project Settings → Script Properties (`AdminEmails` must include the trustee's own Google account email; without it, `setupSheets` returns `NOT_AUTHORIZED`). Then run `setupSheets` once from the editor's function picker to create the `Sessions` and `Checkins` tabs.

1. **Manifest verification:** Open `dist/appsscript.json` and assert `oauthScopes` array contains EXACTLY `"https://www.googleapis.com/auth/spreadsheets"` and `"https://www.googleapis.com/auth/userinfo.email"` and nothing else. This is the source-of-truth check; the consent screen will render these via Google's user-friendly language (e.g. "See, edit, create, and delete your spreadsheets in Google Drive") which we do not assert verbatim.
2. **Consent flow sanity check:** Open the `/dev` URL in a logged-out incognito window. Confirm the consent screen appears, lists Google's user-friendly description of the two scopes (plus any Apps Script-implicit baseline scopes), and successfully proceeds to the app on accept. Take a screenshot of the consent screen for the final report; do NOT assert on exact wording.
3. **Golden path:** Start a net (Sunday Practice, W7ABC, current date/time, no repeater, no notes) → Logging screen → type `K7XYZ` + LOG → type `W7DEF` + LOG → type `W7DEF` + LOG (same callsign, different timestamp — re-tap) → type `W7GHI` + LOG → verify: 4 check-in events visible, W7DEF row shows ×2, header counts read "4 check-ins · 3 unique" → tap End Net → confirm → display shows "4 check-ins logged. 3 unique callsigns." → click Open Sheet → verify: one Sessions row with Status=Closed, EndTimestamp populated; three Checkins rows (K7XYZ TapCount=1, W7DEF TapCount=2, W7GHI TapCount=1); LastTappedByNCOEmail populated.
4. **Edge case — invalid callsign:** type `w7abc` (lowercase) → inline error visible, LOG button disabled.
5. **Edge case — empty configuration:** Set `SpreadsheetId` to an empty string in Properties; reload the `/dev` URL → "App not configured" page renders.
6. **Edge case — retry preserves eventId (idempotency):** Type `K7XYZ` + LOG. Open DevTools, set Network throttling to "Offline" briefly so the first call fails with `withFailureHandler`, then come back online. The client retries with the SAME `eventId`. Server sees two identical `(sessionId, callsign, eventId)` tuples; second is deduped. Verify the Sheet shows one row with tapCount=1, not 2.
7. **Mobile viewport check:** Open the app on a phone (or Chrome DevTools mobile emulation at 375×667). Verify the LOG button and Callsign input render at ≥48 px physical, the layout fits in one column, and no horizontal scroll appears.

For test step 5, restore `SpreadsheetId` after the assertion.

---

## README content (overview)

The Slice 1 README will cover, in order:

1. Prerequisites: Node 20+, npm, a Google account with permission to create Apps Script projects, a Google Spreadsheet to use as the data store.
2. Install: `git clone`, `npm install`.
3. One-time Google-side setup:
   - Create a new standalone Apps Script project at script.google.com.
   - Create a new Google Spreadsheet. Copy its ID from the URL.
   - **Set the Spreadsheet's sharing** to the audience that should be able to follow the "Open Sheet" link. Recommended starting point: trustee + EC as Editors; the rest of WashCoARES as Viewers if you want NCOs to be able to read the log. The web app's `access: ANYONE` controls who can use the logging UI; Google ACL on the Spreadsheet controls who can read the underlying rows.
   - In the Apps Script editor: Project Settings → Script ID → copy. Project Settings → Script Properties → Add property `SpreadsheetId` (value = the Spreadsheet ID). Add property `AdminEmails` (value = comma-separated emails authorized to call `setupSheets`; at minimum your own).
4. One-time local-side setup:
   - `npx clasp login` (or `npm exec clasp login`).
   - Copy `.clasp.json.example` to `.clasp.json` and paste the Script ID.
5. First push: `npm run push`. After it succeeds, in the Apps Script editor's function picker, select `setupSheets` and run it once. Confirm the Spreadsheet now has `Sessions` and `Checkins` tabs.
6. Deploy: `npm run deploy -- --description "Slice 1 initial deploy"` → copy the `/dev` URL from the deploy output, or run `npx clasp deployments` to list.
7. Open the `/dev` URL in a browser to use the app.

Plus sections: "Local development" (`npm run lint`, `npm run typecheck`, `npm run test`, `npm run format`); "Known limitations" (cross-org email empty string, no offline mode, plain text input instead of Suffix-Tap, no monthly email yet, and **"if the NCO closes or reloads the Start tab during a slow request, the retry mints a new requestId and may create a duplicate session row — look for paired same-minute Sessions rows in the Sheet and merge if needed"**).

---

## Out-of-scope follow-ups (noted, not built)

- **Suffix-Tap thumb-zone keypad** (PRD FR-3) — biggest deferred piece of UX.
- **Roster + Sunday-Sync** (FR-2, FR-11) — Slice 1 records literal callsigns only; no name resolution.
- **Unknown-callsign queue + async FCC resolver** (FR-5, FR-6) — every callsign is "manual" in the Source column.
- **Undo / edit-on-tap** (FR-7, FR-8) — corrections happen by editing the Sheet directly.
- **Backfill count-only** (FR-10).
- **MailApp summary at End Net** (part of FR-9).
- **Monthly trigger** (FR-12).
- **5-year purge** (FR-13).
- **Access-mode toggle UX** (FR-14) — Slice 1 ships `access: ANYONE`; toggling to `DOMAIN` is a manual manifest edit + redeploy.
- **Conflict toast** (FR-15) — first-write-wins behavior in place; the cross-NCO toast UX is deferred. **Schema captures `LastTappedByNCOEmail` so this lands without a Sheet migration.**
- **Multi-NCO handoff** (FR-16).
- **PWA + IndexedDB + offline writes.**
- **Full WCAG 2.1 AA pass** (axe / Lighthouse audit).
- **Better-than-linear scan in `recordCheckin`** — CacheService-backed per-session callsign index for year-5+ scale.
- **Husky / lint-staged pre-commit hooks.**
- **Client-side jest tests via jsdom.**
- **Real date validation** (calendar correctness; current regex accepts 2026-02-30).

---

## Round 4 changes (response to round 3 goldfish gaps)

Round 3 critic surfaced 15 residual gaps; readiness passed. Round 4 closes the 15:

| Round 3 gap | Resolution |
|---|---|
| #1 Logger mock missing | Added `globalThis.Logger = { log: jest.fn() }` to §Mock shapes. |
| #2 `getUrl()` mock return undefined | Added fixture detail: `MOCK_SPREADSHEET_ID` constant, deterministic URL string. |
| #3 `RecordCheckinResult` missing `INVALID_INPUT` | Added the variant to the discriminated union. |
| #4 `EndSessionResult` missing `INVALID_INPUT` | Added the variant. |
| #5 `AdminEmails` parsing semantics | Specified: split on `,`, trim, lowercase compare; empty caller email is never a match; empty `AdminEmails` denies all. |
| #6 setupSheets lock vs auth order | Specified: auth check OUTSIDE the lock; lock acquired only after authorization succeeds. |
| #7 `getOrCreateSheetWithHeader` contract contradiction | Split into two helpers: `getSheetOrNull` (read-only, used by runtime paths) and `getOrCreateSheetWithHeader` (creates, used only by `setupSheets`). Runtime paths refuse with `NOT_CONFIGURED` when the tab is missing. |
| #8 `eventId` scope per (sessionId, callsign) | Added explicit "eventId scope" note in §Concurrency. |
| #9 Lock-release tests for all 4 functions | Added test names for `startSession`, `endSession`, `setupSheets`. |
| #10 `withLock<T>` signature | Promoted to a code-fenced declaration in §Server helper signatures with explicit return type and lock-release semantics. |
| #11 requestId reload limitation | Added explicit note to README's "Known limitations" section. |
| #12 Explicit `endSession` flow | Added a numbered flow in §Concurrency mirroring `recordCheckin`'s. |
| #13 Sessions scan cost | §Apps Script execution budget now accounts for both Sessions and Checkins scans. |
| #14 Test `RequestId` column populated | Tightened the `startSession` test name to verify the column write. |
| #15 setupSheets idempotency preserves data | Tightened the idempotency test name to assert data rows byte-identical. |

---

## Round 3 changes (response to round 2 goldfish gaps)

The round 2 critic surfaced 25 gaps; readiness surfaced 22 questions. Round 3 changes:

| Round 2 gap | Resolution |
|---|---|
| Critic #1 (schema vs algorithm mismatch on `LastTappedTimestamp`) | **Addressed.** Schema now has column J `LastTappedEventId` (replacing the never-defined `LastTappedTimestamp`); idempotency dedup uses `eventId` UUID, not wall-clock. |
| Critic #2 / #3 (clientTimestamp idempotency unsafe) | **Addressed.** `RecordCheckinInput` now takes `eventId: string` (client-generated UUID per LOG tap; preserved across retries). `clientTimestamp` removed from the input shape. |
| Critic #4 (requestId / sessionId not format-validated) | **Addressed.** §"Server-side input policy" specifies non-empty string ≤64 chars validation. Format beyond that is not validated by design. |
| Critic #5 (endSession race test description misleading) | **Addressed.** Test name in §Verification trimmed; the "shouldn't happen" hedge removed because `recordCheckin` rejects on closed sessions inside the lock. |
| Critic #6 (header literals missing) | **Addressed.** New §"Header row literals" section publishes `SESSIONS_HEADERS` and `CHECKINS_HEADERS` constants the implementer writes and tests assert on. |
| Critic #7 (`exceptionLogging: "STACKDRIVER"` vs "CLOUD") | **Accepted with note.** `"STACKDRIVER"` still works per current Apps Script docs. Either value is fine; implementer may substitute `"CLOUD"` without changing behavior. |
| Critic #8 (setupSheets exposure on google.script.run) | **Addressed.** New `AdminEmails` script property; setupSheets returns `NOT_AUTHORIZED` if caller email is not in the list. Unauthenticated probes get a hard no. |
| Critic #9 (cross-org empty email same-timestamp edge) | **Resolved by eventId adoption.** Dedup no longer compares emails — UUID is the entire key. |
| Critic #10 (crypto.randomUUID polyfill) | **Addressed.** §UX Screen 1 publishes the `uuid4()` polyfill (~12 lines) used everywhere client mints UUIDs. |
| Critic #11 (retry mechanics underspecified) | **Addressed.** §UX Screen 2 LOG flow steps 8-9 specify the 4-call max budget, the inner BUSY_TRY_AGAIN 3-retry vs. outer network-error 1-retry separation, and `inFlightCheckin` retry-state slot. |
| Critic #12 (Spreadsheet sharing config) | **Addressed.** README §3 now specifies the recommended sharing posture (trustee + EC editors, optional WashCoARES viewers). |
| Critic #13 (tsconfig + ts-jest CommonJS mismatch) | **Addressed.** Split into `tsconfig.json` (ESNext for build) and `tsconfig.test.json` (CommonJS for jest). jest config invokes ts-jest with `tsconfig: 'tsconfig.test.json'`. |
| Critic #14 (`setupFilesAfterEach` Jest key uncertainty) | **Addressed with a verification note.** §Surfaces touched / `jest.config.js` row specifies the key with a footnote: "Verify against Jest 29 docs at implementation time; substitute the equivalent if Jest renamed it." Not a blocker. |
| Critic #15 (`resetMocks` lifecycle hook) | **Addressed.** §Mock shapes now says setup.ts installs globals at module load AND registers `beforeEach(resetMocks)` at the top level (the setup-after-framework hook makes jest globals available). |
| Critic #16 (esbuild IIFE-strip claim hand-waved) | **Addressed.** §Build chain now publishes the literal esbuild config: `format: 'iife'` + `globalName: '__app__'` + `footer: 'for (var k in __app__) { this[k] = __app__[k]; }'`. ~10 lines, no string surgery. Includes a sentence on the canonical CJS-with-footer alternative if the IIFE pattern hits an issue at impl. |
| Critic #17 (.clasp.json location) | **Addressed.** §Build chain → Layout says ".clasp.json lives at the repo root with rootDir: ./dist." |
| Critic #18 (bootstrap idempotency log) | **Addressed.** setupSheets adds `Logger.log` confirmation; tested. |
| Critic #19 (clasp deploy slots) | **Addressed.** New `npm run redeploy` script uses `clasp deploy --deploymentId <id>` to reuse a deployment slot. README §6 notes the 20-deployment cap. |
| Critic #20 (hoursTotal missing from endSession) | **Addressed.** `EndSessionResult.hoursTotal: number` added; formula `uniqueCallsignCount * 0.5` per PRD FR-9. |
| Critic #21 (PRD divergence on dedup tuple) | **Addressed.** §Idempotency semantics explicitly notes the divergence from PRD §Implementation hints (`clientTimestamp` → `eventId`) and justifies it. |
| Critic #22 (no lock-release-on-exception test) | **Addressed.** Test list adds: "exception thrown inside the lock: lock is released before the exception propagates." |
| Critic #23 (empty-session endSession test) | **Addressed.** Test list adds: "zero check-ins endSession returns 0/0/0." |
| Critic #24 (requestId durability across page reload) | **Accepted as v0 risk.** README's Known Limitations notes: if the user closes the Start tab before getting a response, a retry will mint a duplicate session. Mitigated in a future slice by `localStorage`-backing the requestId. |
| Critic #25 (getEffectiveUser one-liner) | **Addressed.** §OAuth scopes mentions: we use `getActiveUser()` for accountability; `getEffectiveUser()` is never called because `executeAs: USER_ACCESSING` makes them equivalent. |
| Readiness #1-#22 | **Resolved together.** §Server helper signatures publishes the exact signatures of `getSpreadsheetOrNull`, `getOrCreateSheetWithHeader`, `appendRowAndGetIndex`, `findRowIndex`, `readRow`, `updateCells`. Column-index enums published. Header row literals published. Validator error messages tabulated. clampString policy specified. Time-zone semantics specified. ANYONE access value documented. dist/ layout specified. Build chain made concrete. Same as the critic resolutions above for overlapping concerns. |

---

## Revision response log (round 1 → round 2)

Each numbered gap from goldfish round 1 is either resolved by a doc change, or rebutted with a reason. Critic gaps prefixed `C`, readiness questions prefixed `R`.

| Gap | Resolution |
|---|---|
| C1 (XFrameOptionsMode.DEFAULT no-op) | **Addressed.** §HtmlService rendering removes the call. |
| C2 (appsscript.json undefined) | **Addressed.** New §"`appsscript.json` literal" gives the complete JSON skeleton; `timeZone: "America/Los_Angeles"` chosen with a flag to PRD Open Question #3. |
| C3 (consent-screen "EXACTLY two scopes" assertion brittle) | **Addressed.** §Verification step 1 now asserts on `dist/appsscript.json` contents; step 2 is a non-asserting consent-screen sanity check that takes a screenshot. |
| C4 (ScriptApp.getService().getUrl() contradiction) | **Addressed.** §HtmlService rendering removes the claim; §UX Screen 3 / §Failure modes clarify the Open Sheet URL comes from `endSession`'s `spreadsheetUrl`. |
| C5 (no per-event NCO attribution → FR-15 needs schema migration later) | **Addressed.** `Checkins` column I `LastTappedByNCOEmail` added; updated on every re-tap. FR-15 now lands without a schema migration. |
| C6 (endSession idempotency semantics underspecified) | **Addressed.** §Interfaces → "Idempotency semantics" specifies preserve original `EndTimestamp`, recompute counts, return `alreadyClosed: true`. |
| C7 (cross-org empty-string downplayed) | **Addressed.** §OAuth scopes adds an explicit "Cross-org empty-string behavior" subsection; surfaces as a documented v0 limitation referencing PRD FR-14. Captured in README's Known Limitations. |
| C8 (recordCheckin idempotency missing) | **Addressed.** Idempotency key `(sessionId, callsign, clientTimestamp)` honored in §Concurrency; uses caller email as a second component to distinguish a different NCO logging the same instant. |
| C9 (startSession idempotency missing) | **Addressed.** `requestId` added to `StartSessionInput`; `Sessions.RequestId` column L added; dedup logic in §Concurrency. |
| C10 (setupSheets has no admin gate) | **Acknowledged with rationale.** Slice 1 does not introduce an admin gate; the function is idempotent and non-destructive. The README's Known Limitations notes any caller can run it; this is acceptable for v0 and tightens with FR-14. |
| C11 (SpreadsheetId set-how not specified) | **Addressed.** §State management specifies: Apps Script editor → Project Settings → Script Properties → key `SpreadsheetId`. No `setSpreadsheetId` server function (explicit rationale given). README §3 covers the steps. |
| C12 (getScriptLock vs getUserLock not justified) | **Addressed.** §Concurrency now has a "Why `getScriptLock`" justification paragraph. |
| C13 (doGet's read behavior ambiguous) | **Addressed.** §UX flow → doGet section + §Apps Script execution budget both say `doGet` performs zero Sheet reads. |
| C14 (tryLock contention testing) | **Addressed.** §Mock shapes exposes `setLockAvailable(boolean)` to control the mock. |
| C15 (callsign regex too narrow) | **Addressed.** §Validators publishes the exact regex `^[A-Z0-9]{2,7}(?:\/[A-Z0-9]{1,5})?$` accepting MM/AM/AE/AG/QRP/N/digit-portable and prefix-portable forms. Test list expanded. |
| C16 (clientTimestamp unused) | **Addressed.** Now used as the `recordCheckin` idempotency key per §Concurrency. |
| C17 (Chrome MCP test URL deployment unspecified) | **Addressed.** README §6 covers `npm run deploy` + `clasp deployments`. The deploy npm script is in §Build chain. |
| C18 (verification step 4 reproducibility) | **Addressed.** Reworded as "Edge case — empty configuration: set `SpreadsheetId` to empty string" (reproducible; doesn't require an un-run of setupSheets). |
| C19 (PaperBackfill enum value premature) | **Addressed.** §Sheet schema: the `Source` column ships with only `"Manual"` written or tested in Slice 1; the column exists for the future slice but no enum value beyond `"Manual"` is referenced. |
| C20 (no client-side tests / no jsdom) | **Addressed.** §Scope→Out explicitly says "no client-side jest tests in Slice 1; UI verified via Chrome MCP only." |
| C21 (no Prettier / formatting baseline) | **Addressed.** Prettier added to deps and tooling (`.prettierrc.json`, `.prettierignore`, `npm run format`, `eslint-config-prettier` integrated). Husky/lint-staged are deferred to a later slice with explicit note. |
| C22 (tsconfig target ES2019 strips ES2020 features) | **Addressed.** §Surfaces touched / tsconfig now targets ES2020. |
| C23 (clasp install convention) | **Addressed.** `@google/clasp` is a dev dep; README and npm scripts use `npx clasp` consistently. |
| C24 (no viewport meta, no CSS spec) | **Addressed.** §UX flow → "Visual / CSS spec" gives complete CSS spec; viewport meta in §HtmlService rendering. |
| C25 (FR-15 deferral mis-stated) | **Addressed.** Schema captures `LastTappedByNCOEmail`; §Scope→Out explicitly notes "Schema captures `LastTappedByNCOEmail` so this lands without a Sheet migration." |
| C26 (clasp login missing from README) | **Addressed.** README §4 covers `npx clasp login`. |
| C27 (Utilities.getUuid wrapper rationale) | **Addressed.** §Surfaces touched / `ids.ts` row now justifies the wrapper as a deterministic-sequence injection point for tests. |
| C-IDOR (spreadsheetUrl exposure note) | **Addressed.** §UX Screen 3 adds a note that the URL is intentional and Google ACL is the real defense. |
| R1 (callsign regex unspecified) | **Addressed.** §Validators publishes the regex and test list. |
| R2 (clasp TS cross-file imports) | **Addressed.** §Build chain explains the esbuild bundle approach; src/ uses normal `import`/`export`; clasp pushes a bundled `dist/Code.gs`. |
| R3 (`webapp` block in appsscript.json) | **Addressed.** Literal JSON in §"`appsscript.json` literal". |
| R4 (timezone unspecified) | **Addressed.** `America/Los_Angeles` chosen with a flag to PRD Open Question #3 for confirmation. |
| R5 (clientTimestamp purpose) | **Addressed.** Used as the `recordCheckin` idempotency key. |
| R6 (endSession overwrite EndTimestamp?) | **Addressed.** §Interfaces → "Idempotency semantics" specifies preservation; test list asserts. |
| R7 (Open Sheet URL source contradiction) | **Addressed.** Only `endSession`'s `spreadsheetUrl`; the template gets nothing from `doGet`. |
| R8 (`npm run setup` wiring) | **Addressed.** Slice 1 drops `npm run setup` entirely. `setupSheets` is invoked from the Apps Script editor's function picker once (documented in README §5). No `clasp run` configuration needed. |
| R9 (setSpreadsheetId function existence) | **Addressed.** No such function in Slice 1; Properties UI is the configured path. |
| R10 (mock API shape) | **Addressed.** §Mock shapes publishes the literal interface and helper functions. |
| R11 (sheets.ts helper signatures) | **Addressed.** §Mock shapes references plus the §Surfaces touched row gives function names; in-test assertions in §Verification criteria fix the contract: `appendRowAndGetIndex` returns the 1-indexed row, `findRowIndex` returns -1 if not found, etc. |
| R12 (CSS spec absent) | **Addressed.** §UX flow → "Visual / CSS spec". |
| R13 (getActiveUser cross-org behavior) | **Addressed.** §OAuth scopes → "Cross-org empty-string behavior" — accept empty string; document as v0 limitation. |
| R14 (client-side counter state model) | **Addressed.** §UX Screen 2 → "Client-side state model" specifies the in-memory shape and derivation formulas. |
| R15 (viewport meta missing) | **Addressed.** §HtmlService rendering specifies it; §Visual/CSS spec confirms. |
| R16 (standalone vs Sheet-bound contradiction) | **Addressed.** §State management and README §3 are now unambiguous: standalone Apps Script, separately-created Spreadsheet, ID in Script Properties. |
| R17 (jest configuration target) | **Addressed.** §Surfaces touched / `jest.config.js` specifies CommonJS, `setupFilesAfterEach`, testMatch. |
| R18 (tapCount post-increment) | Withdrawn by reviewer; no action. |
| R19 (date / time regex specifics) | **Addressed.** §Validators publishes the regexes. Real calendar validation noted as Out-of-scope. |
| R20 (clasp rootDir flatness) | **Addressed.** §Build chain — esbuild collapses src/ into one `dist/Code.gs`; clasp's `rootDir: "./dist"` doesn't see subdirectories. |
| R21 (`exceptionLogging` etc.) | **Addressed.** Literal manifest includes `exceptionLogging: "STACKDRIVER"`, `runtimeVersion: "V8"`. |
