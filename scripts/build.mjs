/**
 * Build script: bundles src/server/*.ts into a single dist/Code.gs, then copies
 * src/html/index.html and appsscript.json into dist/. Run via `npm run build`.
 *
 * Teaching notes:
 *  - The `.mjs` extension tells Node "this is an ES module" so `import` works.
 *  - esbuild's `format: 'iife'` wraps the bundled code in:
 *        var __app__ = (() => { ...; return { doGet, startSession, ... }; })();
 *    so all our exported functions land on the `__app__` object.
 *  - The `footer` then emits EXPLICIT top-level function declarations that proxy
 *    into `__app__`. Why declarations rather than `this[k] = __app__[k]` property
 *    assignment: Apps Script's script editor populates its "Run" dropdown and
 *    discovers web-app / trigger entry points by STATIC parsing of the deployed
 *    code, looking for `function name() { ... }` declarations. Property assignment
 *    is invisible to that static scan even though the function would be callable
 *    at runtime — so the dropdown comes up empty and human-triggered runs (like
 *    the first-time `setupSheets()` call) have nowhere to start.
 *  - The shims forward `arguments` so they're robust to signature changes in
 *    `main.ts` (e.g. when `doGet` starts taking the event object).
 *  - We use `await import()` for esbuild and `node:fs/promises` for file ops — no
 *    callbacks; modern async/await throughout.
 */

import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const SRC_ENTRY = 'src/server/main.ts';
const SRC_HTML = 'src/html/index.html';
const SRC_MANIFEST = 'appsscript.json';
const DIST = 'dist';
const DIST_CODE = `${DIST}/Code.gs`;
const DIST_HTML = `${DIST}/index.html`;
const DIST_MANIFEST = `${DIST}/appsscript.json`;

async function main() {
  // Clean and recreate dist/.
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // Bundle TypeScript sources into one Apps Script-compatible file.
  await build({
    entryPoints: [SRC_ENTRY],
    bundle: true,
    outfile: DIST_CODE,
    format: 'iife',
    globalName: '__app__',
    footer: {
      js: [
        'function doGet() { return __app__.doGet.apply(this, arguments); }',
        'function startSession() { return __app__.startSession.apply(this, arguments); }',
        'function recordCheckin() { return __app__.recordCheckin.apply(this, arguments); }',
        'function endSession() { return __app__.endSession.apply(this, arguments); }',
        'function setupSheets() { return __app__.setupSheets.apply(this, arguments); }',
      ].join('\n'),
    },
    target: 'es2020',
    platform: 'neutral',
    charset: 'utf8',
    logLevel: 'info',
  });

  // Copy the HtmlService template and the Apps Script manifest verbatim.
  await copyFile(SRC_HTML, DIST_HTML);
  await copyFile(SRC_MANIFEST, DIST_MANIFEST);

  console.log(`\nBuild OK:\n  ${DIST_CODE}\n  ${DIST_HTML}\n  ${DIST_MANIFEST}\n`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
