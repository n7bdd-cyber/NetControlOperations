# Net Control Operations

> **Project overview (placeholder):** An independent Google Workspace web app for net control operations, built with TypeScript and deployed to Google Apps Script via `clasp`. Frontend uses HtmlService; backend integrates with Google Drive, Sheets, and other Workspace APIs. Replace this paragraph with a real product description once the project takes shape.

This file is the project-local context for Claude Code (CLI agent). The user-level profile and global preferences are in the parent `Git/.claude/CLAUDE.md` and continue to apply here.

## Working with Claude Code (slash commands)

Five slash commands in [.claude/commands/](.claude/commands/) wrap an "elephant/goldfish" workflow inspired by [this article](https://drensin.medium.com/elephants-goldfish-and-the-new-golden-age-of-software-engineering-c33641a48874): the "elephant" is the working session with full context (this CLAUDE.md, repo state, conversation history); the "goldfish" is a fresh subagent with no prior context. For implementation work the goldfish stress-tests a problem/design doc or a diff. For brainstorming and PRD writing, multiple goldfish run in parallel with different lenses to generate divergent ideas or research findings the elephant synthesizes.

| Command | When to use |
|---|---|
| `/eg-brainstorm <rough idea>` | Early-stage concept design. Multiple goldfish in parallel (technical / business / UX / contrarian / market research), web search optional, elephant synthesizes a concepts brief. All questions via `AskUserQuestion`. Hands off to `/eg-prd` or `/eg-new-feature` if you pick a direction. |
| `/eg-prd <idea \| feature description>` | Build a thorough PRD: codebase grounding → structured gap-filling via `AskUserQuestion` → deep research with parallel goldfish (web + optional Chrome MCP for logged-in sources) → synthesized PRD. Saves to `plans/prds/`, persists durable nuggets to memory, and/or hands off to `/eg-new-feature`. |
| `/eg-fix-bug <description \| #issue \| URL>` | Bug fix flow: problem doc → goldfish diagnosis check → failing test → fix → `/eg-precommit-review` → test gate. Skips ceremony for trivial diffs. |
| `/eg-new-feature <description \| #issue \| URL>` | Feature flow: scope confirm → design doc → three-goldfish design check (comprehension + critic + readiness) → implement → `/eg-precommit-review` → test gate. OAuth-scope minimization, HtmlService XSS, Apps Script quota / 6-minute limits, and LockService usage for shared writes are part of the design rubric. |
| `/eg-precommit-review` | Local independent-review loop on the pending diff (eslint + tsc + jest, plus Chrome MCP for any UI / `doGet` / `doPost` change). Replaces back-and-forth with PR bots — by the time the PR opens, the substantive review is already settled. |

You give a one-liner; Claude writes the doc back at you. You don't author docs by hand. Examples:

```
/eg-brainstorm what if check-ins synced live to a shared Sheet that participants can subscribe to
/eg-prd a check-in form where participants self-register at the start of a session
/eg-fix-bug the timestamp on logged check-ins is off by an hour after DST
/eg-fix-bug #123
/eg-new-feature export the session log to a formatted Google Doc
/eg-precommit-review
```

Browser validation: use the Claude in Chrome MCP (`mcp__Claude_in_Chrome__*`) pointed at `http://localhost:8080`. Apps Script web apps don't have a true local dev server — for HTML/JS iteration use a static server on port 8080; for full Apps Script behavior, deploy via `npx clasp push` and point Chrome MCP at the resulting `script.google.com/macros/.../dev` test URL.

Each command stops short of committing. Authorize the commit explicitly when ready. Per the user's global preferences: clean, commented, secure code; short imperative subject lines; reference GitHub issues with `Fix #<n>:` when applicable; **no `Co-Authored-By: Claude` trailers** in commit messages unless explicitly requested.

## Stack & tooling (planned)

The repo is not yet scaffolded. The slash commands above assume the following commands once `package.json` exists:

| Step | Command |
|---|---|
| Install deps | `npm install` |
| Lint | `npx eslint .` |
| Type-check | `npx tsc --noEmit` |
| Unit tests | `npx jest` |
| Push to Apps Script | `npx clasp push` |
| View Apps Script logs | `npx clasp logs` |
| Local UI dev server | (TBD — static server on `http://localhost:8080`) |

Layout (planned):
- `src/` — TypeScript sources (server-side modules, types, validators) and HtmlService templates
- `src/server/` — Apps Script entry points (`doGet`, `doPost`) and Workspace-API wrappers
- `src/html/` — HtmlService templates (`.html` files included in the Apps Script project)
- `tests/` — Jest tests (`*.test.ts`); use `jest.fn()` doubles for Apps Script globals (`SpreadsheetApp`, `DriveApp`, `UrlFetchApp`, `Session`, `LockService`, `PropertiesService`)
- `appsscript.json` — Apps Script project manifest (OAuth scopes, time-driven triggers, web-app deployment settings)
- `.clasp.json` — local clasp configuration (script ID, root dir); keep out of version control if it points at a personal project
- `plans/prds/` — Product Requirements Documents written by `/eg-prd`
- `plans/eg-brainstorms/` — Concept briefs written by `/eg-brainstorm`
- `docs/` — Long-form documentation
- `memory/` — Persistent notes for the agent
- `AI/` — Workspace for AI-driven artifacts (other than the slash-command outputs above)

When a command differs from the above table (e.g. lint becomes `pnpm lint`, jest becomes `vitest`), update both this table AND the matching command in `.claude/commands/eg-*.md` so the slash commands keep working.

## Apps Script + Google Workspace constraints (always-on review items)

These constraints inform every command's "Hunt for" list and design rubric:

- **6-minute execution limit.** Long-running operations need `LockService` + a checkpoint/resume pattern (persist progress to PropertiesService, install a continuation trigger), or batched processing.
- **Quotas.** `UrlFetchApp` (daily call cap), `MailApp.sendEmail` (daily send cap), Drive write throughput. Handle quota errors gracefully — catch and back off, never silent-fail.
- **HtmlService XSS.** Use `<?= value ?>` (auto-escapes) for any user-controlled data in templates. Treat `<?!= value ?>` (no escaping) as a bug unless the data is provably safe and that's documented at the call site.
- **OAuth scope minimization.** Every scope in `appsscript.json` expands the user-consent prompt and the blast radius. Add scopes only when strictly necessary; remove scopes that the code no longer needs.
- **Concurrency on shared writes.** `Sheet`, `PropertiesService`, and shared Drive files are all subject to lost-update races. Wrap write paths in `LockService.getScriptLock().tryLock(...)` (or `getDocumentLock` / `getUserLock` as appropriate).
- **PropertiesService scope.** `getScriptProperties()` is shared across all users (good for config + secrets, bad for per-user state). `getUserProperties()` is per-user. `getDocumentProperties()` is per-bound-document. Picking the wrong scope is a security bug.
- **Secrets.** Never in source files. `PropertiesService.getScriptProperties()` is the secret store. Add a `.clasp-keep-secrets-out-of-git` reminder during scaffolding.
- **`Session.getActiveUser()` vs `getEffectiveUser()`.** In a web-app deployment, `getActiveUser()` is the logged-in caller (often empty unless deployed with `executeAs: USER_ACCESSING`); `getEffectiveUser()` is the script owner. Picking the wrong one is an authentication bug.
- **IDOR via Drive / Sheet IDs.** Never construct client-visible URLs from raw file IDs without an auth re-check on the server.
- **Trigger management.** `ScriptApp.newTrigger(...)` is additive — every install accumulates a trigger. Always dedup before installing (loop `getProjectTriggers()`, delete matching ones, then install once).
- **V8 runtime.** Apps Script V8 is JavaScript with no `eval`, no ES modules in `.gs` files (clasp transpiles TypeScript / bundles for you, but be aware), default strict mode.
