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

**Baseline recorded (2026-09-08):**
- `npm run typecheck:web` — PASS (exit 0)
- `npm run test:run -- src/renderer` — 59 files / 255 tests pass; 14 vitest worker-startup timeout errors (environmental — extremely slow transform on this machine, not real test failures). Exit 0.

Fix approach (user directive 2026-09-08): sequential subagents, one per slice F1→F12. Each writes a failing test reproducing the bug where feasible, then fixes all findings in that slice, runs typecheck + that slice's tests, commits to main, updates TRACKER.

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

| ID | Summary | Status |
|---|---|---|
| F12-01 | No error boundary anywhere → any render throw blanks the app | TODO |

### Batch B — high — fix individually

| ID | Summary | Status |
|---|---|---|
| F1-01 | `window.electron` exposes full ipcRenderer + `process.env` | DONE (57876a2) |
| F3-01 | useMessages out-of-order response overwrites active chat | DONE (c544c87) |
| F5-01 | TextMessage markdown identity `urlTransform` → `javascript:`/`data:` link XSS | DONE (e0cac7a) |
| F6-01 | Voice note delivered to wrong chat after switch mid-record | DONE (a802146) |
| F7-01 | ChatSearchSidebar out-of-order search responses | DONE (737b13d) |
| F8-01 | No stream abort on AI session switch → streamed answer lost | DONE (f037405) |
| F11-01 | PluginIcon injects raw plugin SVG via dangerouslySetInnerHTML | TODO |
| F12-02 | Navigation via unbuffered `smartchat:open-chat` window event drops intents | TODO |

### Batch C — med — batch per slice (48 total)

| Slice | Med count | Status |
|---|---|---|
| F1 | 2 | DONE (57876a2) — F1-02, F1-03 + F1-04/05/06 lows |
| F2 | 2 | DONE (d19178c) — F2-01, F2-02 + F2-03/04/05/06/07 lows |
| F3 | 6 | DONE (141a819) — F3-02..F3-10 (9 findings: 6 med + F3-08/09/10 low); F3-11 wontfix-for-now |
| F4 | 2 | DONE (F4 all 7 findings fixed on main) |
| F5 | 5 | DONE (3eee44c) — F5-02..F5-05 med + F5-06/07/08/10/11/13 low; F5-09 partial (b/c fixed, a deferred); F5-12 wontfix; F5-14 fixed in 98827f0 (shared BaseModal via F10-05) |
| F6 | 6 | DONE (ecfc4d7) — F6-02..F6-07 med + F6-08/09/10/11/13/14 low; F6-05 in a802146; F6-12 already resolved; F6-13 partial (regex hoisted; caret-offset rework deferred) |
| F7 | 3 | DONE (96e8b6a) — F7-02/03/04 med + F7-05/06/07 low + F7-08 (partial); F7-06 select-all cap deferred |
| F8 | 6 | DONE (2cb46c9) — F8-02..F8-07 med + F8-08/10/11/12/13 low; F8-09 fixed in 98827f0 (shared BaseModal via F10-05) |
| F9 | 4 | DONE (b129aea renderer + bceb3b3 F9-04 webview hardening) — F9-01/03/04 med fixed; F9-02 wontfix-deferred (no theme toggle exists); + lows F9-07/08/09/10/11/12 fixed, F9-05/06 partial |
| F10 | 6 | DONE (98827f0 shared BaseModal primitive + routing incl. F5-14/F8-09; 7a898b1 webview security/CSP + form validation) — all 13 F10 findings fixed (F10-01..13), 0 wontfix |
| F11 | 2 | TODO |
| F12 | 4 | TODO |

### Batch D — low — triage or WONTFIX wholesale
_decision pending_

---

## How to resume (any session)

1. Read this file + `TRACKER.md`.
2. Record baseline if not done.
3. First `TODO` row in Batch A → B → C → D order.
4. Follow the per-fix protocol.
5. Update this file + TRACKER + commit.
