# SmartChat Backend Bug Audit

A partitioned, multi-session audit of the SmartChat **backend** (`src/main/**`,
`packages/sdk/**`). The codebase is too large to audit in one session, so work is
split into slices. Each session audits one slice and records findings.

> Scope for now: **backend only.** Renderer / `src/renderer` / UI is out of scope.

---

## How to run a session (do this every time)

1. **Read [`TRACKER.md`](./TRACKER.md).** It is the single source of truth for
   what has been done and what was found.
2. Pick the **lowest-numbered slice whose status is `TODO`**. Set it to
   `IN PROGRESS` (with today's date) and commit that one-line change.
3. Read **every `.ts` file in the slice**, plus its existing tests
   (`src/main/tests/**` mirrors the service layout).
4. Hunt for the bug classes in the checklist below. **Confirm each finding by
   reading the actual call sites** — do not report speculative issues.
5. Append confirmed findings to the slice's section in `TRACKER.md` using the
   finding format below.
6. Set the slice status to `DONE (<n> findings)` with the date. Commit
   `TRACKER.md`.
7. Report a short summary to the user.

**Do NOT fix bugs during the audit.** Auditing and fixing are separate phases so
the review stays coherent and the user can triage. Fixing happens later, driven
by the tracker.

If a session runs out of context mid-slice: record partial findings, note in the
status line which files are still unread (`IN PROGRESS — done through <file>`),
commit. The next session resumes from there.

---

## Bug-class checklist (apply to every slice)

**This list is a floor, not a ceiling.** It names the classes most likely to be
missed on a skim — always sweep for all of them — but report *any* defect you can
substantiate, in scope or not: wrong business logic / spec violations, incorrect
conditionals, off-by-one, bad math, wrong units, security holes (injection, auth
bypass, path traversal, SSRF, secrets in source, unsafe deserialization), missing
input validation, memory / handle leaks, deadlocks, unbounded growth, performance
cliffs (N+1, accidental O(n^2), sync work blocking the event loop), API contract
mismatches between caller and callee, incorrect error messages, dead code hiding
a bug, config/build issues. If it would surprise or harm a user, or violate the
code's evident intent, it's in scope.

- **Async correctness**: floating promises, missing `await` (esp. inside loops,
  `forEach`, event handlers, constructors), `await` in a loop that should be
  parallel, unhandled rejection paths.
- **Race conditions**: event subscription registered *after* the thing that
  emits (e.g. after socket `open`), unguarded shared mutable state, check-then-act
  on async state, concurrent writers to the same record.
- **Error handling**: swallowed errors (`catch {}`, `catch (e) { log }` then
  continue as if success), partial failure leaving inconsistent state, no
  rollback, rettelling the caller "ok" after a failed sub-step.
- **Persistence / SQL**: string-interpolated SQL, missing transaction around
  multi-write operations, missing `WHERE`, wrong dedup/unique key, prepared
  statements or DB handles never finalized.
- **Trust boundary**: data from IPC, plugins, or the HTTP `apiServer` used
  without validation; path traversal; permission check missing or performed
  *after* a side effect.
- **Resource leaks**: event listeners, timers/intervals, watchers, sockets, DB
  statements not cleaned up on teardown / error / plugin unload.
- **Sync logic**: off-by-one, pagination cursor bugs, ordering assumptions,
  timestamp vs. sequence confusion, dedup key mistakes, lost updates.
- **Data-shape assumptions**: WhatsApp / Baileys payloads assumed non-null or of
  a fixed shape; optional fields dereferenced; JID/LID normalization mistakes.
- **Lifecycle**: startup/shutdown ordering, double-init, use-after-dispose,
  reconnect not re-establishing all state.

---

## Slice map

See [`TRACKER.md`](./TRACKER.md) for status. Slices are ordered by expected
bug density / blast radius.

| # | Slice | Paths (under `src/main/` unless noted) |
|---|-------|---------------------------------------|
| 1 | WhatsApp worker & socket | `workers/whatsapp/**` |
| 2 | Message pipeline | `services/messages/**` (incl. `formatters/`, `processors/`) |
| 3 | WhatsApp service & subscribers | `services/whatsapp/**` |
| 4 | Chats & sync | `services/chats/**`, `services/sync/**`, `historySync.ts` |
| 5 | Contacts | `services/contacts/**` |
| 6 | AI (providers, mentions, citations, prompts) | `services/ai/**` |
| 7 | Kernel API modules & router | `kernel/api-modules/**`, `kernel/KernelAPIRouter.ts`, `kernel/IKernelAPIRouter.ts`, `kernel/KernelBootstrapper.ts` |
| 8 | Kernel plugins, contributions, permissions | `kernel/plugins/**`, `kernel/contributions/**`, `kernel/permissions/**` |
| 9 | Kernel storage, channels, ipc, ui | `kernel/storage/**`, `kernel/channels/**`, `kernel/ipc/**`, `kernel/ui/**` |
| 10 | App IPC & auth | `ipc/**`, `ipcHandlers.ts`, `auth.ts`, `services/auth/**`, `ServiceContainer.ts` |
| 11 | apiServer, search, notification, calls, audio | `services/apiServer/**`, `services/search/**`, `services/notification/**`, `services/calls/**`, `services/audio/**` |
| 12 | SDK, tools, data wipe, domain, db, protocol | `packages/sdk/src/**`, `tools/**`, `services/DataWipeService.ts`, `domain/**`, `db/**`, `services/protocol/**`, `services/storage/**` |
| 13 | Cross-cutting pass | end-to-end event flow, transaction boundaries spanning services, startup/shutdown ordering — do AFTER 1–12 |

---

## Finding format (append to the slice section in TRACKER.md)

```
### [S<slice>-<nn>] <sev: crit|high|med|low> — <file>:<line>
**What:** one-line description of the defect.
**Why it's a bug:** the incorrect behavior / failure scenario, with concrete
inputs or state that trigger it.
**Fix idea:** short suggestion.
**Status:** open
```

Severity guide: **crit** = data loss / corruption / security; **high** = feature
broken or wrong results in common cases; **med** = wrong in edge cases or
recoverable; **low** = smell / latent / minor.

---

## Reference: codebase facts

- Electron app. Backend = the Electron **main** process (`src/main`) + a
  **WhatsApp worker** (separate process/thread under `src/main/workers/whatsapp`)
  + the **plugin SDK** (`packages/sdk`).
- Microkernel design: see `docs/architecture/microkernel.md`, `modules.md`,
  `ADR.md`, `ai-context.md`.
- DB: `better-sqlite3` (synchronous). Template DB at `resources/template.db`,
  generated by `scripts/generate-template.js`. Migrations under `prisma/`.
- Tests: `vitest`. Run one: `npm run test:run -- <path>`. All:
  `npm run test:run:all`. **After running tests, must
  `npm run test:rebuild:electron` before `npm run dev`** (tests rebuild native
  modules for Node, app needs Electron ABI).
- Typecheck: `npm run typecheck` (node + web).
- Recent bug-fix areas (git log): WhatsApp event subscription ordering vs.
  connection, CodeTantra OTP relay plugin. Slice 1 & 3 should scrutinize these.
