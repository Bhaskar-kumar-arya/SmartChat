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
| S3-01 + S13-01 | `KernelEventsModule.ts` + `WhatsAppConnectionManager.ts` + `src/main/index.ts` | same root cause: bus-created callback wired after connect() → plugin WA events dead from cold start. **Fix together, one commit.** | DONE — `onBusConnected` re-attaches all live subs to a new bus (S3-01); `onBusCreated` wired synchronously + buffers bus until kernel boot resolves (S13-01); regression tests |
| S7-01 | `KernelMessagesModule.ts` + `KernelChatsModule.ts` + `KernelContactsModule.ts` + `KernelEventsModule.ts` | resource-scope enforced inconsistently across kernel API (bypass) | DONE — message-id actions scope on the real owning chat via injected lookup; getList/batchGetByJids filtered; event payloads best-effort per-chat filtered; regression tests |

### Batch D — medium findings, per slice (batch, ~5-10 each)

| Slice | Med count | Status |
|---|---|---|
| 1 — WhatsApp worker & socket | 5 | DONE (2026-09-06) — S1-01/02/04/05 fixed, S1-03 wontfix (not a bug) |
| 2 — Message pipeline | 6 | DONE (2026-09-06) — S2-01..06 all fixed (S2-02 UI-retry deferred as follow-up feature) |
| 3 — WhatsApp service & subscribers | 2 | DONE (2026-09-06) — S3-02 (unpause only on wa-sync-complete) + S3-03 (safety timer covers between-chunk inactivity only; finishSync deferred while a chunk writes) fixed. FIX_PLAN's "3" was a miscount — slice 3 has 2 med. |
| 4 — Chats & sync | 4 | DONE (2026-09-06) — S4-01 (per-batch try/catch), S4-03 (batched identity prefetch), S4-04 (persist unreadCount>=0) fixed; S4-02 done: correctness bugs fixed, 60× enrichment perf refactor = WONTFIX (user decision 2026-09-07) |
| 5 — Contacts | 2 | DONE (2026-09-06) — S5-01 (per-stub merge in one interactive $transaction), S5-02 (new ContactCacheSyncSubscriber flushes main-process contact caches on wa-sync-complete) |
| 6 — AI | 7 | DONE (2026-09-06) — S6-02 ('ai' role → assistant in Groq/Mistral/DeepSeek), S6-03 (maxTurns cap 25 + abort between turns), S6-04 (Gemini abortSignal threaded), S6-05 (empty-name skip + replacer fn + boundary), S6-06 (escapeXml on all strategy interpolations), S6-07 (citation persist createMany→per-row upsert fallback), S6-08 (userData path + corrupt-file backup+throw + atomic write) |
| 7 — Kernel API modules & router | 4 | DONE (2026-09-06) — S7-02 (sendMedia path containment), S7-03 (ai:sessions capability split), S7-04 (tool-name conflict reject + unregister on unload), S7-05 (overlay:send/close require ui:overlay + ownership) |
| 8 — Kernel plugins/contributions/permissions | 6 | DONE (2026-09-06) — S8-02/03/04 already fixed by b42bff6 (S7-01); S8-05 (atomic write + fail-closed on corrupt), S8-06 (KernelEventsModule.removePlugin unload hook), S8-07 (await worker deactivate ack before destroy) |
| 9 — Kernel storage/channels/ipc/ui | 6 | DONE (2026-09-07) — S9-01 (panelIpc lazy getBus + onBusConnected re-attach wired in index.ts), S9-02 (panel event subscribe permission-gated), S9-03 (webContents 'destroyed' cleanup), S9-04 (30s PLUGIN_TIMEOUT on both plugin channels' sendRequestToPlugin), S9-05 (OverlayHost: reject on missing window + pending-timeout eviction + dispose()), S9-06 (panelHost.deregisterPlugin on unload + changed-panelPath re-register) |
| 10 — App IPC & auth | 4 | DONE (2026-09-07) — S10-03 (readData throws on transient error, both auth copies), S10-04 (resolveInsideDir containment), S10-05 (execute-tool gated to trusted frame + audit log), S10-06 (isTrustedSender on destructive channels); guards in src/main/ipc/ipcGuards.ts |
| 11 — apiServer/search/notification/calls/audio | 7 | DONE (2026-09-07) — S11-02 (no rewrite on unreadable prefs), S11-03 (fail pendingJobs on worker death + vectorless embed_done), S11-04 (re-check pause per loop iteration), S11-05 (call-log monotonic/terminal guard), S11-06 (ffmpeg error rejects + cleanup + unique name), S11-07 (deepSearch post-filter; core already S2-03), S11-08 (body size cap + Buffer.concat + idle timeout) |
| 12 — SDK/tools/data wipe/domain/db/protocol | 6 | DONE (2026-09-07) — S12-02 (win32 case-normalized containment check), S12-04 (abort flag refuses tool calls after timeout + clearTimeout in finally), S12-06 (migration failure now propagates as fatal — both call sites), S12-07 (busy_timeout + INSERT OR IGNORE + in-tx re-check), S12-08 (strip string literals/comments before forbidden-keyword scan — both tools), S12-09 (always wrap query as capped subquery). Also folded S13-08 (will-quit hard timeout) opportunistically. |
| 13 — Cross-cutting | 5 | DONE (2026-09-07) — S13-02 (will-quit retains bootResult + disposes kernel/WA/embedding worker/tray under a hard timeout), S13-03 (WAWorkerBridge per-command 30s timeout), S13-04 (unexpected worker exit → wa-disconnected event + WhatsAppConnectionManager bounded backed-off reconnect, 5 attempts), S13-05 (EmbeddingWorkerManager.terminate() + shutdown wiring), S13-06 (BaileysPatcher collects patch failures → hard throw in dev, best-effort when packaged) |

### Batch E — low findings — WONTFIX (user decision 2026-09-07)

All 51 low-severity findings are **deliberately not being fixed**. They remain
logged in TRACKER.md for reference; if any is later promoted, pull it into a new
batch. No triage pass needed.

| Slice | Low count | Status |
|---|---|---|
| 1–13 | 51 total | WONTFIX (low value — user decision 2026-09-07) |

---

## Fix phase — COMPLETE (2026-09-07)

- Batch A (crit) — DONE (3)
- Batch B (RCE/sandbox, high) — DONE (3)
- Batch C (correctness, high) — DONE (5)
- Batch D (med, all 13 slices) — DONE (65; S4-02 perf refactor carved out as WONTFIX)
- Batch E (low) — WONTFIX (51)

**Carried-forward, non-bug follow-ups (not blocking):**
- S2-02 — manual send-retry / outbox UI (feature, not a bug)
- S4-02 — community-grouping perf refactor (WONTFIX unless perf becomes a problem)
- S6-01 — ⚠️ leaked API keys still need provider-side revoke + rotate by the user
  (still live in git history)

**Remaining before declaring the backend done:** the consolidation verification
pass — full `npm run test:run:all` + `npm run typecheck` against the recorded
baseline, then a manual in-app smoke test of the touched subsystems. See
"Consolidation verification" section below once run.

---

## How to resume (any session)

1. Read this file + `TRACKER.md`.
2. If baseline not recorded, record it.
3. Find the first `TODO` row in Batch A → B → C → D → E, in that order.
4. Follow the per-fix protocol above.
5. Update this file's status + TRACKER's finding + commit.
