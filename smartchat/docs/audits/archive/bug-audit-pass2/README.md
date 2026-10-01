# SmartChat Backend Bug Audit — Pass 2

A second, **independent, full-depth** audit of the SmartChat backend
(`src/main/**`, `packages/sdk/**`; renderer out of scope — see
`../bug-audit-frontend/` for that). Unrelated to the earlier
`../bug-audit/` audit — you do not need to read that folder to work here.
This is a fresh read of the current codebase, not a diff or a gap-fill.

Same partitioning strategy as before (the codebase is too large for one
session), same rigor: read every file in a slice, fully, before filing
findings.

---

## How to run a session (every time)

1. **Read [`TRACKER.md`](./TRACKER.md).** Single source of truth.
2. Pick the **lowest-numbered slice with status `TODO`**. Set it `IN PROGRESS`
   (with today's date). Commit that one-line change.
3. Read **every file in the slice, in full** — not a skim, not "read until it
   looks fine." Include its existing tests (`src/main/tests/**` mirrors the
   service layout).
4. Apply the bug-class checklist below to everything you read. **Confirm each
   finding by reading the actual call sites** — no speculative findings.
5. Append confirmed findings to the slice's section in `TRACKER.md` (format
   below).
6. Set slice status `DONE (<n> findings)` with the date. Commit `TRACKER.md`.
7. Report a short summary to the user.

**Audit only — do not fix during the audit.** That's a separate phase, driven
by `FIX_PLAN.md`, once slices are done.

Ran out of context mid-slice: record partial findings, set status
`IN PROGRESS — done through <file>`, commit. Next session resumes there.

Slices 1–12 are independent — safe to run in parallel sessions (assign
non-overlapping slices; each session commits only its own status row +
findings section, leaving the summary-counts table for a final reconciliation
pass). Slice 13 (cross-cutting) must be last.

---

## Bug-class checklist — a floor, not a ceiling

Sweep for all of the named classes below on every file — but report **any**
defect you can substantiate, whether or not it fits a named class: wrong
business logic / spec violations, incorrect conditionals, off-by-one, bad math,
wrong units, security holes (injection, auth bypass, path traversal, SSRF,
secrets in source, unsafe deserialization), missing input validation, memory /
handle leaks, deadlocks, unbounded growth, performance cliffs (N+1, accidental
O(n²), synchronous work blocking the event loop), API contract mismatches
between caller and callee, incorrect error messages, dead code hiding a bug,
config/build/dependency issues. If it would surprise or harm a user, or
violate the code's evident intent, it's in scope.

Named classes to always check:

- **Async correctness**: floating promises, missing `await` (esp. inside
  loops, `forEach`, event handlers, constructors), `await` in a loop that
  should be parallel, unhandled rejection paths.
- **Race conditions**: event subscription registered *after* the thing that
  emits, unguarded shared mutable state, check-then-act on async state,
  concurrent writers to the same record.
- **Error handling**: swallowed errors (`catch {}`, log-then-continue),
  partial failure leaving inconsistent state, no rollback, reporting success
  after a failed sub-step.
- **Persistence / SQL**: string-interpolated SQL, missing transactions around
  multi-write operations, wrong dedup/unique key, unfinalized statements/handles.
- **Trust boundary**: data from IPC, plugins, or the HTTP `apiServer` used
  without validation; path traversal; permission checks missing or performed
  after a side effect.
- **Resource leaks**: listeners, timers, watchers, sockets, DB statements not
  cleaned up on teardown / error / plugin unload.
- **Sync logic**: off-by-one, pagination cursor bugs, ordering assumptions,
  timestamp vs. sequence confusion, dedup mistakes, lost updates.
- **Data-shape assumptions**: WhatsApp/Baileys payloads assumed non-null or a
  fixed shape; optional fields dereferenced; JID/LID normalization mistakes.
- **Lifecycle**: startup/shutdown ordering, double-init, use-after-dispose,
  reconnect not re-establishing all state.
- **Business-logic correctness**: is the rule actually right, independent of
  concurrency/error-handling framing — inverted conditions, wrong precedence,
  wrong WhatsApp/Baileys semantics.
- **Performance**: N+1 queries, accidental O(n²), synchronous work blocking
  the event loop/main thread, unbounded loops over growing data.
- **Numeric / date / timezone / encoding** edge cases.

---

## Slice map

Identical partition to the earlier audit — read fully regardless of what that
audit's notes said was "deep" vs "light."

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
### [P2-S<slice>-<nn>] <sev: crit|high|med|low> — <file>:<line>
**What:** one-line description of the defect.
**Why it's a bug:** the incorrect behavior / failure scenario, with concrete
inputs or state that trigger it.
**Fix idea:** short suggestion.
**Status:** open
```

Severity: **crit** = data loss / corruption / security; **high** = feature
broken or wrong results in common cases; **med** = wrong in edge cases or
recoverable; **low** = smell / latent / minor.

---

## Reference

- Build/test: `npm run typecheck`, `npm run test:run -- <path>`,
  `npm run test:run:all`. After tests, `npm run test:rebuild:electron` before
  `npm run dev` (tests rebuild native modules for Node, app needs Electron ABI).
- DB: `better-sqlite3` via Prisma. Template DB `resources/template.db`.
- Architecture docs: `docs/architecture/*`.
