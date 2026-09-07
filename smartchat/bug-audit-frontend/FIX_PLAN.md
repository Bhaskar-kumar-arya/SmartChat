# Frontend Fix Phase Plan

Companion to [`TRACKER.md`](./TRACKER.md) (findings) and [`README.md`](./README.md)
(audit protocol). Do not start the fix phase until enough slices are `DONE` to
triage meaningfully (ideally all F1–F12).

Same conventions as the backend fix phase (`../bug-audit/FIX_PLAN.md`):

- **Commit directly to `main`** — no branch-per-fix (user preference).
- **Test-first where feasible** — write a failing renderer test
  (`src/renderer/tests/**`, vitest + Testing Library) reproducing the bug, then fix.
- **Manually verify in the running app** for anything a unit test can't fully
  exercise: IPC event wiring, chat-switch races, streaming, webview/panel
  behaviour, focus/scroll. Use `npm run dev` + React DevTools. Note what was
  checked in the TRACKER finding.
- Record a baseline first (see below) so new breakage is distinguishable from
  pre-existing.

---

## 0. Baseline (record once, before any fix)

```
npm run typecheck:web
npm run test:run -- src/renderer
```
Record exact pass/fail here before starting.

**Baseline recorded (____-__-__):** _pending_

---

## Per-fix protocol

1. Failing test first, where feasible.
2. Minimal fix.
3. Run that test file, then `npm run typecheck:web`.
4. Manual check in `npm run dev` where the bug class needs it
   (`npm run test:rebuild:electron` first if tests were just run).
5. Commit to `main`: `fix(fe-auditN): F<slice>-<nn> <short desc>`.
6. Update the finding in `TRACKER.md`: append `**Fix status:** fixed in <commit>
   — <test added> + <manual check result>`.
7. Update the batch table below.

crit/high: one at a time, own commit. med: batch per slice. low: triage
(`fix` vs `wontfix` with reason) then batch loosely — or WONTFIX wholesale like
the backend low findings, user's call.

---

## Batches (fill in after triage)

Statuses: `TODO` · `IN PROGRESS` · `DONE` · `WONTFIX`

### Batch A — crit (security / data loss / app crash) — fix individually
_populate from TRACKER after audit_

### Batch B — high — fix individually
_populate from TRACKER after audit_

### Batch C — med — batch per slice

| Slice | Med count | Status |
|---|---|---|
| F1–F12 | _tbd_ | TODO |

### Batch D — low — triage or WONTFIX wholesale
_decision pending_

---

## How to resume (any session)

1. Read this file + `TRACKER.md`.
2. Record baseline if not done.
3. First `TODO` row in Batch A → B → C → D order.
4. Follow the per-fix protocol.
5. Update this file + TRACKER + commit.
