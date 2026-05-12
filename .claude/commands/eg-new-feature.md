---
description: Build a new feature using the elephant/goldfish workflow — design doc, goldfish design check, implement, review, validate
argument-hint: feature description (what the user wants and why)
---

Build a new feature using the elephant/goldfish workflow. The aim: design before code, let a fresh goldfish stress-test the design doc, then implement, review, and validate.

`$ARGUMENTS` is the feature description provided by the user. If empty, ask for one before doing anything. If `$ARGUMENTS` is a GitHub issue URL or `#<number>`, fetch it with `gh issue view <number> --json title,body,labels,comments` and seed the design doc from it.

## Step 0: Confirm scope before designing

Restate the request back to the user in 1-2 sentences ("I read this as: <X>. Confirm or correct."). Misreads at this stage waste the most time later. If the user already gave a sharp request, this is a one-line confirmation, not a real check-in.

**Surface-area sanity-check** (Apps Script + Google Workspace specifics):
- Pure server-side TypeScript change (data transform, helper, validator): straightforward.
- HtmlService UI change (templates under the HTML files included in the Apps Script project): straightforward; Chrome MCP verification required.
- New `doGet` / `doPost` route or change to existing entry-point response: confirm — every route surfaces a contract change clients depend on.
- Google Workspace API touch (Drive / Sheets / Docs / Calendar / Gmail): confirm OAuth scope additions in `appsscript.json` and re-justify each.
- Long-running operation (>1 min expected): require LockService + checkpoint/resume design (Apps Script kills jobs at 6 min).
- New time-driven or installable trigger: confirm idempotency, dedup-on-install, and quota cost.
- New external HTTP integration (`UrlFetchApp` to a non-Google host): confirm allow-list, retry/backoff, and quota usage.
- Schema-shaped change to a Sheet or Properties store the app already reads: treat like a migration — design backward-compat or backfill plan.

## Step 1: Write the design doc

Print the design doc to the user. For most features this lives in chat; for substantial features (new domain area, new entry-point family, new subsystem) propose writing it to `plans/` and ask the user before creating the file.

Required sections:

```
DESIGN DOC
- Why: <user problem this solves; cite GH issue, conversation, or PRD section>
- Scope: <what is in; what is explicitly out>
- Surfaces touched: <files / entry points (doGet/doPost) / HtmlService templates / Sheet ranges / Properties keys / external services>
- Interfaces: <function signatures, doGet/doPost request/response shapes, Sheet column layouts, Properties keys, payload shapes for client-server communication via google.script.run>
- UX flow: <click-by-click for UI; request-by-request for backend>
- OAuth scopes: which scopes does this require? Are any new? List the exact scope strings going into `appsscript.json` and justify each.
- State management: which PropertiesService scope (script / user / document) holds what? Which CacheService keys, with what TTL?
- Concurrency: does this write to a shared resource (Sheet, Properties, Drive file)? If yes, LockService strategy (`getScriptLock`, `getUserLock`, `getDocumentLock`) and lock duration.
- Apps Script execution budget: estimated max runtime per invocation. If >2 min, design for checkpoint/resume via PropertiesService + a continuation trigger.
- HtmlService rendering: any user-controlled data injected via templates? Confirm `<?= ?>` (escaping) is used, NOT `<?!= ?>`. Any inline event handlers — flag CSP implications.
- Failure modes: what the user sees on quota exhaustion, OAuth scope revocation, network timeout, lock contention, missing Sheet, deleted Drive file
- Verification criteria: jest unit tests, Apps Script live-deployment manual checks, Chrome MCP walkthroughs at http://localhost:8080 or the deployed test URL
- Out-of-scope follow-ups: <noted, not built>
```

If a PRD already exists in `plans/prds/`, reference it explicitly ("implements PRD §<section>") so the design doc and the source-of-truth PRD stay aligned. The design doc should not redo PRD-level decisions; it should translate them into shapes the implementer can build.

For UI work, sketch the visual structure in plain text or pseudo-HTML. If the design needs a real visual reference, ask the user to point at an existing template or component to mirror.

### No-code gate

**Do NOT edit, write, scaffold, or refactor code until BOTH Pass B (Critic) AND Pass C (Readiness) in Step 2 close with their ready tokens (`design ready` + `implementation ready`).** Article rule, paraphrased: *"I do not want you to create code. We are not going to create code. Resist your impulse."* This holds until the design doc passes both gates — even if the user asks to skip ahead, even if the change "looks trivial", even if it is "just one line".

If the user explicitly asks to skip the gate ("just write the code", "skip the design doc", etc.), restate the gate, name the still-open passes, and require an explicit override ("yes, override the no-code gate") before touching any file outside the design doc itself. The exception is `/eg-fix-bug` for trivial fixes covered by its own Step 0 triviality gate — that is a separate command with a separate gate.

The design doc itself, test names mentioned in chat (not yet on disk), and read-only exploration (`Read`, `Grep`, `Bash` for `git status` / `git log` / `git diff`, `npx tsc --noEmit`, `npx eslint . --no-fix`, `npx clasp status`, `npx clasp logs`) are NOT code edits and are permitted.

## Step 2: Three-goldfish design check

Run the article's full design-stage protocol: three sequential `Agent` calls per round (or two on revisions — see below), each with no prior context. The combined gate is "ready iff critic AND readiness both sign off"; comprehension is informational.

Each pass uses `subagent_type: "general-purpose"` and gets ONLY the design doc (no chat history, no implementation intent, no other passes' output). The asymmetry is the value.

**Round 1 runs all three passes; round 2+ skips comprehension** (revisions are gap-driven, not structural — once the doc reads cleanly, it almost always still reads cleanly). On every round, run critic and readiness.

### Pass A — Comprehension (round 1 only)

`description: "Goldfish comprehension check"`. Verifies the doc reads cleanly to a cold reader.

```
<<<COMPREHENSION_START>>>
You are a fresh reader with no prior context. Below is a design doc for a feature in the Net Control Operations repo, an independent Google Workspace web app built with TypeScript on Google Apps Script. Do NOT critique it yet. Your job is to verify the doc reads clearly to someone who walks in cold.

Output two short sections in this order:

## What this feature does
2-5 sentences in your own words. The user-visible change. Who triggers it, when, what they get back.

## How the existing system works (per the doc)
2-5 sentences summarizing the current behavior the doc describes touching. Surfaces, entry points (doGet/doPost), HtmlService templates, Sheet/Properties keys, message flow — whatever the doc references.

End your output with EXACTLY one of these closing lines, on its own line:
- comprehension passed       (the doc reads cleanly; no ambiguous sections)
- comprehension unclear      (one or more sections are too vague to paraphrase)

If you mark it unclear, list the ambiguous sections by heading before the closing line. Do NOT critique architecture choices here — that is the critic's job. Only flag things you genuinely cannot understand.

DESIGN DOC:

<PASTE FULL DESIGN DOC FROM STEP 1 HERE>
<<<COMPREHENSION_END>>>
```

### Pass B — Critic (every round)

`description: "Goldfish design critic"`. Finds gaps that block implementation.

```
<<<DESIGN_START>>>
You are a fresh reviewer with no prior context. Below is a design doc for a feature in the Net Control Operations repo, an independent Google Workspace web app built with TypeScript on Google Apps Script (clasp), HtmlService for the web UI, and the Google Workspace APIs (Drive / Sheets / etc.). CLAUDE.md at the repo root has the architecture, including the Apps Script execution model, OAuth scope policy, LockService usage for shared writes, and the Chrome MCP browser verification path.

Your job: read the design doc, then read the surfaces it claims to touch, and find holes BEFORE implementation starts. Specifically:

- Is the scope crisp? What questions would you have to answer to implement this that the doc does not answer?
- Are the interfaces concrete enough that two implementers would converge on the same result?
- Do the verification criteria actually verify the feature, or only verify that "something rendered"?
- Does the doc misunderstand any existing code? Look up the surfaces it claims to touch and check.
- Are there failure modes the doc missed? Network errors, unauthenticated users, empty state, partial saves, stale data, retries.
- Apps Script-specific gaps:
  - OAuth scopes: are the new scopes listed and minimum-necessary? Will users get a re-consent prompt? Does any scope expand the blast radius beyond what's needed?
  - Execution time: is the doc honest about the 6-minute limit? If the operation could exceed that, where's the checkpoint/resume design?
  - Quotas: UrlFetchApp daily cap, MailApp send cap, Drive write cap — does the doc account for hitting them?
  - Concurrency: any shared writes (Sheets, Properties) without LockService? Any race between concurrent users?
  - HtmlService XSS: any user data flowing into templates via `<?!= ?>` instead of `<?= ?>`?
  - PropertiesService scope: script vs user vs document — is the right scope chosen for each piece of state?
  - Trigger management: any `ScriptApp.newTrigger(...)` without dedup/cleanup logic?
  - `Session.getActiveUser()` vs `getEffectiveUser()`: did the design pick the right one for this web-app deployment context?
  - Sheet/Drive ID exposure: does the design send raw file IDs to the client where IDOR could occur?
- Are there project-specific gotchas the doc ignores? CLAUDE.md is your reference.

If a PRD exists in `plans/prds/` for this work, also load it and check that the design doc is consistent with the PRD's scope, success metrics, and constraints.

For UI work, you may navigate the running dev server via Chrome MCP (`mcp__Claude_in_Chrome__*` against http://localhost:8080) or the deployed Apps Script test URL to verify how an existing surface behaves before judging the design's fit.

DESIGN DOC:

<PASTE FULL DESIGN DOC FROM STEP 1 HERE>

Output: numbered list of gaps, with file:line citations where applicable. End with `design ready` ONLY if you have zero gaps. Otherwise list them and end with `design needs revision`.
<<<DESIGN_END>>>
```

### Pass C — Readiness (every round)

`description: "Goldfish implementation readiness"`. Stricter than the critic: not "is the design good?" but "is the design _executable_ in one pass?"

```
<<<READINESS_START>>>
You are a fresh implementer with no prior context. Below is a design doc for a feature in the Net Control Operations repo, an independent Google Workspace web app built with TypeScript on Google Apps Script. Imagine you've been told: "Implement this. First pass. No follow-up questions allowed." Could you?

For every interface, file path, function signature, doGet/doPost request/response shape, Sheet column, Properties key, OAuth scope string, HtmlService template name, and verification criterion the doc claims, ask:
- Could I write the corresponding code without asking the author anything?
- Could I verify it works without asking what "works" means?
- Are the cited files and line numbers concrete enough that I'd open the right file and edit the right region?

Output a numbered list of EVERY question you would have to ask the author before you could ship. For each:
- The question itself, one sentence.
- The section of the doc that should have answered it but didn't.

If the list is empty, say "No open questions."

End with EXACTLY one of these closing lines, on its own line:
- implementation ready       (zero open questions; first-pass implementable)
- implementation not ready   (one or more open questions remain)

A design can be beautiful and still fail this gate. The critic asks "is the design good?"; you ask "is the design executable?".

DESIGN DOC:

<PASTE FULL DESIGN DOC FROM STEP 1 HERE>
<<<READINESS_END>>>
```

### Triage and loop

A round is **ready** iff Pass B closes with `design ready` AND Pass C closes with `implementation ready`. Comprehension is informational: log it, surface it to the user, but do not gate progress on it. If comprehension returns `comprehension unclear` AND the round is otherwise ready, still proceed — but flag in the final report that the doc was unclear in places.

If a round is **not ready**, bundle the critic gaps and readiness open questions into a single revise prompt:

```
=== CRITIC GAPS ===
<verbatim Pass B output>

=== READINESS OPEN QUESTIONS ===
<verbatim Pass C output>
```

Plus, if Pass A returned `comprehension unclear`, prepend:

```
=== COMPREHENSION FEEDBACK (informational — the cold reader could not paraphrase parts of the doc) ===
<verbatim Pass A output>
```

Tell the elephant to address EVERY numbered gap from BOTH the CRITIC GAPS and READINESS OPEN QUESTIONS sections — do not collapse or skip a section because the numbering restarts. Each gap is either: addressed in a doc revision, or rebutted with a verbatim reason citing CLAUDE.md / the PRD in `plans/prds/` / the user's words from this conversation. Print the revised doc back to the user once both gates close.

Then re-run Pass B and Pass C against the revised doc (skip Pass A — see above). If the round still does not converge after **three revisions**, the feature is under-specified — **stop and ask the user** for more direction rather than burning more rounds.

## Step 3: Implementation plan

Once the design doc is `design ready`, write a short ordered implementation plan in chat. Suggested layer ordering for this stack:

1. **`appsscript.json`** — add any new OAuth scopes; bump time-trigger declarations; update web-app deployment settings if `executeAs` / `access` need to change.
2. **Properties / Sheet schema** — if introducing a new Properties key family or new Sheet columns, document the shape in code comments and add a one-shot migration helper if existing data needs backfill.
3. **Server-side TypeScript modules** (under your source folder, e.g. `src/server/`) — pure logic first (parsers, validators, formatters), then service-layer (Sheet/Drive/Properties wrappers), then composition (entry-point handlers). Add corresponding `*.test.ts` jest tests as you go.
4. **`doGet` / `doPost`** entry points — wire the new server logic in. Verify the response contract.
5. **HtmlService templates and client-side `<script>`** — leaf components first (form fields, list items), then composites, then page glue and `google.script.run` calls.
6. **Triggers / scheduled jobs** — if the feature includes a time trigger or installable trigger, register it via a one-time `ScriptApp.newTrigger(...)` call wrapped in a dedup check.
7. **Tests in parallel** — jest unit tests should be added during steps 3-5; manual Chrome MCP / live-deployment checks come after step 5.

For trivial features (single-file change, no new entry point or scope), skip this step.

## Step 4: Implement

**Pre-flight check before any code edit:** confirm Step 2 closed both Pass B (Critic) AND Pass C (Readiness). If either is still open, the no-code gate from Step 1 still applies — return to Step 2 instead of proceeding.

Follow the plan. After each layer, briefly verify before moving on:

- **`appsscript.json`**: `npx clasp push` and confirm the change took (deploy log shows scope diff). Verify the user-consent prompt re-appears as expected for new scopes.
- **Properties / Sheet schema**: if you wrote a migration helper, dry-run it locally against a test Sheet copy before pointing it at any real data.
- **Server-side TypeScript**: `npx tsc --noEmit` and `npx jest <module>` clean. For Workspace API touches, run a one-off `clasp run <function>` against a test deployment to confirm the API call shape is correct.
- **`doGet` / `doPost`**: hit the deployed test URL via `curl` (for `doPost`) or browser navigation (for `doGet`); inspect the response.
- **HtmlService templates**: drive the page via Chrome MCP, screenshot the relevant region, read the browser console AND `clasp logs` for server-side errors.
- **Triggers**: list installed triggers via `ScriptApp.getProjectTriggers()` (run once via `clasp run`) to confirm exactly one of your new trigger exists, not several.

**For UI changes, drive the feature in the browser before reporting it done.** Use Chrome MCP against `http://localhost:8080` (local static dev surface) or the deployed Apps Script test URL after `npx clasp push`. The built-in preview tools are not enough — actually click the button, fill the form, watch the response, read the console.

**OAuth-scope verification reminder:** any time the design added a scope to `appsscript.json`, after `clasp push` open the deployed web app in a logged-out incognito window, click through the consent screen, and confirm the consent screen lists ONLY the scopes you intended. Surface any unexpected scope on the screen — that signals the manifest is broader than the design.

## Step 5: Hand off to `/eg-precommit-review`

Run `/eg-precommit-review`. Pass the feature name as `$ARGUMENTS` so the reviewer focuses there.

## Step 6: Test gate

```sh
npx eslint .
npx tsc --noEmit
npx jest
```

For UI features, also do a final Chrome MCP walkthrough of the golden path AND the most plausible edge case (empty Sheet / no rows yet, OAuth scope just revoked, quota approaching exhaustion, very long input string, two users editing concurrently if the feature touches a shared Sheet). Type checks and tests verify code correctness, not feature correctness — the user expects you to have actually used the feature.

If `clasp push` hasn't been run since the last code change, do that before the Chrome MCP walkthrough — otherwise the live behavior diverges from the source.

## Step 7: Final report

Print to the user:
- Feature summary (one line)
- Files touched (grouped by layer: appsscript.json / Properties or Sheet schema / server-side TypeScript / doGet/doPost / HtmlService templates / triggers)
- Tests added (file:test name each)
- Design-check result (gaps surfaced and how each was resolved)
- `/eg-precommit-review` outcome (rounds, fixes, rebuttals verbatim)
- Test gate status
- Chrome MCP walkthrough summary (golden path + which edge cases were exercised; OAuth-scope consent screen verification result)
- Out-of-scope follow-ups noted in the design doc

**STOP.** Do NOT commit; auto mode does not override the project's commit policy. Wait for the user's literal commit instruction. Per the user's preferences: short imperative subject lines (`Add X`, `Fix Y`), reference GitHub issues with `Fix #<n>:` when applicable, and **do not** include `Co-Authored-By: Claude` trailers unless explicitly requested.
