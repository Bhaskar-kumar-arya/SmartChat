# Fix Phase Plan

Companion to [`TRACKER.md`](./TRACKER.md) (findings) and [`README.md`](./README.md)
(audit protocol, now complete — 13/13 slices, 127 findings: 3 crit / 8 high / 65
med / 51 low). This file drives the **fix phase**.

Commit directly to `main` (no branch-per-fix). Test-first where feasible, plus
a **manual check in the running app** whenever the bug is the kind a unit test
won't fully catch.

---

## 0. Baseline (do once, before any fix, if not already done)

Run and record results — this is how you tell "I broke something" apart from
"that was already broken":
```
npm run test:run:all
npm run typecheck
```
Note the baseline pass/fail state at the top of this file (below) before
starting Batch A.

**Baseline recorded (2026-09-06):**
- `npm run typecheck` — **clean** (node + web).
- `npm run test:run:all` — **pre-existing failures**, all in flaky plugin e2e
  suites unrelated to backend logic: `kernel/e2e/declarative-modal-plugin`,
  `kernel/e2e/declarative-modal-overlay-plugin`, `kernel/e2e/voice-transcriber-overlay`
  (15s timeout), `kernel/e2e/url-page-reader-plugin`, `milestone2.test.ts`
  (all depend on packaged .scext test plugins that aren't built in CI-less runs).
  ~848/851 pass. Treat these 5 files as the known-bad baseline.

---

## Per-fix protocol

For every finding, in order:

1. **Write a failing test first**, where feasible — reproduce the bug against
   the existing vitest suite (`src/main/tests/**` mirrors the service layout).
   This is the proof the bug existed and stays as permanent regression coverage.
2. Apply the minimal fix.
3. Run that test file, then `npm run typecheck`.
4. **Manually verify in the running app whenever possible** — especially for
   anything a unit test can't fully exercise: IPC wiring, socket/reconnect
   lifecycle, plugin loading, the `app://` protocol handler, panel/overlay IPC,
   data-wipe paths. Use the `run` skill to launch the app and actually exercise
   the affected flow (send a message, trigger a reconnect, open a panel, etc.).
   Note in the finding what was manually checked and what was observed.
5. Run `npm run test:rebuild:electron` before the manual app run if tests were
   just run (tests rebuild native modules for Node; the app needs the Electron
   ABI — skipping this makes `npm run dev` fail confusingly).
6. Commit directly to `main`: `fix(auditN): <slice>-<nn> <short description>`.
7. Update the finding in `TRACKER.md`: append
   `**Fix status:** fixed in <commit> — <test added> + <manual check result>`.
8. Update the batch table below.

For **crit/high** findings, fix one at a time (own commit each). For **med**,
batch by slice (matches audit slices, so context stays loaded). For **low**,
triage first (many are legitimately `wontfix` — note that in TRACKER instead of
forcing a fix) and batch the rest loosely.

---

## Batches

Statuses: `TODO` · `IN PROGRESS` · `DONE` · `WONTFIX`

### Batch A — data loss / secrets (fix individually, crit)

| Finding | File | What | Status |
|---|---|---|---|
| S6-01 | `AIKeyService.ts:8-13` | committed API keys (needs revoke+rotate, not just code fix) | DONE (code) — ⚠️ keys still need provider-side revoke/rotate by user |
| S10-01 | `services/auth/AuthStateRepository.ts:14-24` → `WhatsAppConnectionManager.ts:69-80` | transient authState read error → false `hasCreds()` → wipes logged-in user's data | DONE |
| S12-01 | `services/protocol/AppProtocolHandler.ts:33-36` | `app://local/<abs>` arbitrary file read (LFI) | DONE |

### Batch B — RCE / sandbox escape (fix individually, high)

| Finding | File | What | Status |
|---|---|---|---|
| S12-03 | `tools/ExecuteScriptTool.ts:198-256` | `vm` "sandbox" trivially escapes to host RCE | DONE — no host intrinsics/functions on context global; bridge is closure-only; `constructor` chain escape closed + regression test |
| S11-01 | `services/apiServer/controllers/ToolsController.ts:41-48` | HTTP `/api/tools/execute` bypasses tool permission model | DONE — permission-gated tools now 403 + audit-logged before execute; regression test |
| S8-01 | `plugins/PluginLoader.ts` + `ipc/contributionIpc.ts` | plugin loader path traversal (id/main/zip-slip) → arbitrary dir delete/write/exec | DONE — id+main validated in `validateManifest`; `resolveWithin` containment on install/uninstall/load + zip-entry check; regression tests |

### Batch C — correctness / data integrity (fix individually, high)

| Finding | File | What | Status |
|---|---|---|---|
| S12-05 | `services/DataWipeService.ts:33-76` | partial wipe swallowed, reported success | DONE — single `$transaction` wipe + FK restore in `finally` + re-throw; callers abort/reject on failure; regression tests |
| S10-02 | `auth.ts:223-257` (live copy: `workers/whatsapp/socket/useLocalPrismaAuthState.ts`) | silent Signal keystore tx failure | DONE — retry 3× w/ backoff then throw (forces reconnect); both copies fixed; regression test |
| S3-01 + S13-01 | `KernelEventsModule.ts` + `WhatsAppConnectionManager.ts` + `src/main/index.ts` | same root cause: bus-created callback wired after connect() → plugin WA events dead from cold start. **Fix together, one commit.** | TODO |
| S7-01 | `KernelMessagesModule.ts` + `KernelChatsModule.ts` + `KernelContactsModule.ts` + `KernelEventsModule.ts` | resource-scope enforced inconsistently across kernel API (bypass) | TODO |

### Batch D — medium findings, per slice (batch, ~5-10 each)

| Slice | Med count | Status |
|---|---|---|
| 1 — WhatsApp worker & socket | 5 | TODO |
| 2 — Message pipeline | 6 | TODO |
| 3 — WhatsApp service & subscribers | 3 | TODO |
| 4 — Chats & sync | 4 | TODO |
| 5 — Contacts | 2 | TODO |
| 6 — AI | 7 | TODO |
| 7 — Kernel API modules & router | 4 | TODO |
| 8 — Kernel plugins/contributions/permissions | 6 | TODO |
| 9 — Kernel storage/channels/ipc/ui | 6 | TODO |
| 10 — App IPC & auth | 4 | TODO |
| 11 — apiServer/search/notification/calls/audio | 7 | TODO |
| 12 — SDK/tools/data wipe/domain/db/protocol | 6 | TODO |
| 13 — Cross-cutting | 5 | TODO |

### Batch E — low findings (triage first, then fix loosely batched)

For each low finding, first decide `fix` or `wontfix` (note reason in TRACKER),
then batch the `fix`-marked ones per slice same as Batch D. Not broken out
per-slice here until triage happens — do the triage pass as its own session:
read every low finding across all 13 slices, mark each `WONTFIX` (with reason)
or leave for fixing, tally the result into this table.

| Slice | Low count | Triaged? |
|---|---|---|
| 1 | 3 | no |
| 2 | 6 | no |
| 3 | 2 | no |
| 4 | 5 | no |
| 5 | 3 | no |
| 6 | 3 | no |
| 7 | 4 | no |
| 8 | 3 | no |
| 9 | 4 | no |
| 10 | 4 | no |
| 11 | 6 | no |
| 12 | 5 | no |
| 13 | 3 | no |

---

## How to resume (any session)

1. Read this file + `TRACKER.md`.
2. If baseline not recorded, record it.
3. Find the first `TODO` row in Batch A → B → C → D → E, in that order.
4. Follow the per-fix protocol above.
5. Update this file's status + TRACKER's finding + commit.
