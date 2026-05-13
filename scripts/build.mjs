/**
 * Build script: bundles src/server/*.ts into a single dist/Code.gs, then copies
 * src/html/index.html and appsscript.json into dist/. Run via `npm run build`.
 *
 * Teaching notes:
 *  - The `.mjs` extension tells Node "this is an ES module" so `import` works.
 *  - esbuild's `format: 'iife'` wraps the bundled code in:
 *        var __app__ = (() => { ...; return { doGet, startSession, ... }; })();
 *    so all our exported functions land on the `__app__` object.
 *  - The `footer` then loops over `__app__` and copies each function onto `this`,
 *    which in Apps Script V8 at file scope IS the global object. That's how
 *    `doGet`, `startSession`, etc. become top-level Apps Script functions reachable
 *    by `google.script.run.<funcName>` from the client.
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
    footer: { js: 'for (var k in __app__) { this[k] = __app__[k]; }' },
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
