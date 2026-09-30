# SmartChat audit brief (shared by all audit agents)

Repo: /home/user/SmartChat/smartchat — Electron + TypeScript + React app (WhatsApp client via Baileys
in a worker thread, Prisma/better-sqlite3, multi-provider AI, plugin microkernel, local REST API).
- src/main/**         main process (services, kernel, workers, tools, ipc)
- src/preload/**      preload bridge
- src/renderer/**     React UI
- packages/sdk/**     plugin SDK
- tests: src/main/tests/** , src/renderer/tests/** , packages/sdk/tests/** (vitest, see vitest.config.ts)

Prior audits exist (bug-audit/, bug-audit-pass2/, bug-audit-frontend/) and claim all findings fixed.
Do NOT re-report something already listed there as fixed unless the fix is wrong/incomplete (then say so).
You may grep those TRACKER.md files to check.

## You are READ-ONLY. Do not modify any file in the repo. Do not commit.

## What to produce
Write ONE markdown file at the output path given in your task. Sections:

### 1. Bugs (confirmed)
Only defects you verified by reading the code AND its call sites. For each:
`- [B-<SLICE>-NN] <severity: crit|high|med|low> <file:line> — <one-line defect>`
  then 2-4 lines: concrete failure scenario (inputs/state → wrong result), and suggested fix.
Classes to hunt: async (floating promises, missing await, forEach+async, unhandled rejections), races
(subscribe-after-emit, check-then-act, concurrent writers), resource leaks (listeners, timers, workers,
handles never disposed), wrong logic/conditionals/off-by-one, null/undefined handling, error swallowing
that hides failures, SQL/Prisma misuse (N+1, missing transaction, wrong where), security (path traversal,
injection, XSS, unsafe IPC exposure, SSRF, secrets), IPC contract mismatch main<->preload<->renderer,
React bugs (stale closures, missing/incorrect deps, state updates after unmount, key misuse, effects
without cleanup), JID/LID identity mixups (WhatsApp).
Put "suspected but unconfirmed" items in a separate short list marked SUSPECT.

### 2. Code quality / design issues
Concrete, file-referenced. Examples: god classes/files (give line counts), SRP violations, duplicated
logic (name both locations), leaky layering (UI knowing DB, services importing electron, renderer
bypassing service layer), service-locator/ServiceContainer abuse, `any`/`as` casts (give counts),
dead code / unused exports, inconsistent error handling, magic strings, poor naming, missing types at
boundaries (IPC payloads), circular-ish coupling. Rank by impact. Skip trivial style nits.

### 3. Test quality
For tests covering your slice: which source files have NO tests; which tests are weak (assert only
"toHaveBeenCalled", snapshot-only, over-mocked so they test the mock, test private internals, no
negative/error-path cases, flaky timers/sleeps, shared mutable state between tests, tests that pass
even if the code is broken). Give concrete file names and examples. Note any test helpers/factories
that are duplicated and should be shared.

### 4. Refactor proposal for this slice
Concrete units of work, each small enough for ONE Claude Code session (~1-3 hours, touching a
well-defined set of files). For each unit:
`- [R-<SLICE>-NN] <title>` — goal; files owned (exact paths); depends on (other unit ids or "none");
  risk (low/med/high) and why; safety net needed first (which characterization tests must exist
  before touching it); verification (commands / behaviours to check).
Prefer behaviour-preserving refactors. Flag anything that changes a public contract (IPC channel,
preload API, plugin SDK API, DB schema) explicitly as CONTRACT-CHANGE.
Note shared files many units would need to touch (hotspots) — these limit parallelism.

### 5. Top 5
Your five most important takeaways for this slice, one line each.

Be concrete and terse. File:line references everywhere. Target 150-400 lines of output. Quality over
quantity — a false positive bug report is worse than a missed nit.
