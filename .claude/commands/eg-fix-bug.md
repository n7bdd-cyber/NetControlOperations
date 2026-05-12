---
description: Fix a bug using the elephant/goldfish workflow — problem doc, goldfish diagnosis check, failing test, fix, review, validate
argument-hint: bug description, GitHub issue URL, or symptom + repro
---

Fix a bug using the elephant/goldfish workflow. The aim: write a problem doc, goldfish-check the diagnosis (so we are not anchored to the first hypothesis), capture the bug as a failing test, fix it, then run `/eg-precommit-review` and the test gate.

`$ARGUMENTS` is the bug description provided by the user. If empty, ask for one before doing anything. If `$ARGUMENTS` is a GitHub issue URL or `#<number>`, fetch it first with `gh issue view <number> --json title,body,labels,comments` and seed the problem doc from it.

## Step 0: Triviality gate

**Skip the goldfish/test ceremony for:** typo fixes in copy or comments, dead-code removal, version bumps, formatter-only diffs, single-line config tweaks. Go straight to Step 5 (`/eg-precommit-review`) and the test gate.

**Run the full loop for everything else,** including small one-line code fixes — small diffs hide bugs disproportionately well.

## Step 1: Write the problem doc (in this conversation)

Print a tight problem doc to the user. Keep it brief but complete:

```
PROBLEM DOC
- Symptom: <what the user observes>
- Repro: <steps to reproduce, or "user did not provide; need to derive">
- Suspected area: <file/module/route/worker/job/screen>
- Hypothesised root cause: <one sentence>
- Blast radius: <which other surfaces could be affected>
- "Fixed" means: <specific test passes / specific behavior / specific output>
```

If the user gave no repro and the bug is not obvious from a single file read, **stop and ask** for a repro path (URL, steps, failing test name, log line, screenshot). Do NOT guess. The goldfish needs something concrete to act on.

For UI bugs, the repro path is usually **Chrome MCP** (`mcp__Claude_in_Chrome__*`) against `http://localhost:8080` (the local static dev server) or the deployed Apps Script test URL (`script.google.com/macros/s/.../dev`). Assume the dev server is running; for a deployed-script repro, run `npx clasp push` first if recent local changes haven't been pushed. Navigate, click, take a screenshot, read the console (and check the Apps Script execution log via `clasp logs` for server-side errors).

## Step 2: Goldfish diagnosis check (parallel to your hypothesis)

Spawn a fresh agent with `Agent` tool:
- `subagent_type: "Explore"` for narrow lookups, `"general-purpose"` if the bug spans multiple subsystems. If the harness does not have `Explore` registered, fall back to `general-purpose`.
- `description: "Goldfish bug diagnosis"`

The goldfish gets ONLY the symptom + repro from Step 1. It does NOT get your hypothesised root cause — that asymmetry is the point.

**Prompt body to send (between markers, exclusive):**

```
<<<DIAG_START>>>
Independent diagnosis of a bug in this repo (Net Control Operations, the TypeScript + Google Apps Script web app for coordination operations on Google Workspace; CLAUDE.md at the repo root has the full architecture).

Symptom: <FILL IN from Step 1>
Repro: <FILL IN from Step 1>

Investigate. Where in the codebase is the bug most likely to live? Cite specific file:line locations. List the top 1-3 candidate root causes ranked by likelihood. For each candidate, name what evidence in the code supports it and what would falsify it. Do NOT propose a fix yet — just diagnose.

If a UI repro is needed, you may use the Chrome MCP (`mcp__Claude_in_Chrome__*`) against the running dev server at http://localhost:8080 or the deployed Apps Script test URL. For server-side Apps Script behavior, `clasp logs` shows execution log output.

End with the literal string `diagnosis complete`.
<<<DIAG_END>>>
```

**Compare goldfish output to your Step 1 hypothesis.**
- Convergence (top candidate matches your hypothesis): proceed to Step 3 with confidence.
- Divergence: re-investigate. Read the goldfish's evidence. If it is right, update the problem doc and tell the user "goldfish flagged a different root cause; re-diagnosing." If you are right, write down WHY the goldfish was wrong — that disagreement is itself useful signal.

If the bug is genuinely tiny (1-3 line fix in a clearly-identified location), you may skip the goldfish call — but only when the location is mechanically obvious. When in doubt, run it.

## Step 3: Capture the bug as a failing test BEFORE fixing

The verification criterion lives in code, not in chat. Pick the right tier:

- **Unit (`npx jest`)** — for pure TypeScript logic that runs without Apps Script globals (parsers, date math, validators, formatters). Tests live alongside source as `*.test.ts` or under a `tests/` folder.
- **Service / API mock (`npx jest`)** — for code that touches Google Workspace APIs (Drive, Sheets, etc.) by mocking `SpreadsheetApp`, `DriveApp`, `UrlFetchApp`, `Session`, `LockService`, `PropertiesService`, etc. Use `jest.fn()` doubles for these globals.
- **HTML / client-side UI** — Jest with jsdom for DOM-touching code in `HtmlService` templates' inline JavaScript.
- **Live Apps Script (manual)** — for behaviors that genuinely depend on the Apps Script runtime (quotas, time triggers, OAuth scopes, real Sheet writes). Push via `npx clasp push`, then exercise the deployment.
- **Chrome MCP** — UI bugs in the deployed web app: drive the Chrome MCP against `http://localhost:8080` or the deployed test URL.

Write the test. Run it (`npx jest <path>`). Confirm it fails for the reason described in the problem doc. If it fails for a different reason, the test is wrong — fix the test before touching the implementation.

For UI bugs where a full automated spec is overkill, capture the repro as a Chrome MCP script in the conversation: navigate, click, screenshot, read console — and confirm the bug is observable. This is your verification path; you re-run it after the fix. For server-side Apps Script bugs that resist mocking, the equivalent is a `clasp run` invocation or a Sheet-side button-press repro, captured as a documented sequence.

## Step 4: Fix it

Implement the smallest change that turns the failing test green and matches the "Fixed means" criterion.

Avoid: adjacent refactors, defensive coding for cases the bug did not surface, fallbacks that mask future regressions, unrequested feature flags. Bug fix scope is the bug, nothing else.

Re-run the failing test. It must go green. If it does not, you have not fixed the bug — do NOT rewrite the test.

For UI fixes, re-drive the Chrome MCP repro against `http://localhost:8080` (or the deployed test URL after `npx clasp push`) one more time before reporting done. The user expects you to have actually seen the fix work in the browser, not just seen tests pass.

## Step 5: Hand off to `/eg-precommit-review`

Run `/eg-precommit-review` per the canonical procedure. The reviewer is a second goldfish — it sees only the diff. Triage findings, loop, and exit.

If `/eg-precommit-review` surfaces an issue that the Step 2 diagnosis goldfish missed, note it in the final report — it tells us where the diagnosis prompt needs to be tighter next time.

## Step 6: Test gate

```sh
npx eslint .
npx tsc --noEmit
npx jest
```

For UI bugs, also re-verify the original repro in Chrome MCP (against `http://localhost:8080` or the deployed Apps Script test URL after `npx clasp push`) one final time. For backend-only bugs (pure TypeScript logic, server-side Apps Script that doesn't render UI), skip the Chrome MCP step. If the diff touches `appsscript.json` (OAuth scopes, manifest, time triggers), confirm the change is intentional and minimum-necessary before pushing.

All required tiers must pass. Type checks and tests verify code correctness, not feature correctness — for UI bugs the user expects you to have actually seen the fix in the browser.

## Step 7: Final report

Print to the user:
- Bug summary (one line)
- Root cause (one line)
- Fix (file:line)
- Test that captures it (file:test name)
- Goldfish-vs-elephant agreement (converged / diverged + why)
- `/eg-precommit-review` outcome (rounds, fixes, rebuttals verbatim)
- Test gate status

**STOP.** Do NOT commit; auto mode does not override the project's commit policy. Wait for the user's literal commit instruction. Per the user's preferences: short imperative subject lines (e.g. `Fix off-by-one in check-in timestamp`), reference GitHub issues with `Fix #<n>:` when applicable, and **do not** include `Co-Authored-By: Claude` trailers unless explicitly requested.
