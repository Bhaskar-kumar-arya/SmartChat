# SmartChat — Audit Summary & Refactor Plan

> Status: **APPROVED (owner accepted all recommended decisions, §6). Not yet started.**
> Audit date: 2026-09-30, on commit `8e0f5b8`.
> Detailed per-slice findings: `refactor/audit/{WA,MSG,DATA,AI,KRN,APP,UICHAT,UIAPP}.md`;
> SOLID pass: `refactor/audit/SOLID-{MAIN,RENDERER}.md`.
> Every bug id (`B-<SLICE>-NN`) and refactor id (`R-<SLICE>-NN`) below points into those files.
> **How to run it:** one orchestrator Claude Code session follows `refactor/ORCHESTRATOR.md`, launches
> subagents per unit, and keeps `refactor/TRACKER.md` current. It works locally or in the cloud.
> The skills under `.agents/skills/` are **optional references**, not required. Where they conflict with
> this plan (e.g. the refactor-orchestrator skill's "one worker at a time" rule), this plan wins.

---

## 1. Health snapshot (measured, not estimated)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ passes. But `window.api` is silently typed `any`: `preload/index.d.ts` imports a `types` barrel that doesn't exist, and `skipLibCheck` hides the error. |
| Circular imports (madge, main + renderer) | ✅ none |
| `eslint .` | ❌ 1,694 errors, 9,935 warnings. Of these, 9,910 are Prettier warnings (formatting never enforced), 897 are `no-explicit-any` and **22 are `rules-of-hooks`**. |
| `vitest run` (Linux) | ❌ 6 failing tests, **85 unhandled errors**, 1,203 passing |
| Why tests fail | Not hermetic: unit tests connect to a real LM Studio; a fixture is read from the git-ignored `dev_only/`; e2e plugin tests need `.scext` builds that nothing produces; one test only passes on Windows. |
| CI | Only a macOS DMG build. **No typecheck, lint or test runs on any push or PR.** |
| Coverage tooling | None installed |
| Logging | No logger; 595 raw `console.*` calls |
| Size | ~34k LOC main + ~15k renderer + ~26k tests |
| Secrets | A Gemini API key is committed in `train/Annotate_Data.ts:54`, **in a public repo** (since 2026-09-08). |

Three earlier audits (`bug-audit/`, `bug-audit-pass2/`, `bug-audit-frontend/`) mark every finding
"fixed". This fresh audit found **several of those fixes incomplete**: S12-03 vm sandbox, P2-S5-01
identity split, P2-S10-03 saveCreds, F6-01 staged files, F5-09 waveform, S7-06 callTool, P2-S1-04 skip-sync.
Some regression tests pass while the bug is still present.

## 2. Audit findings

### 2.1 Bug counts (confirmed by reading call sites; several reproduced at runtime)

| Slice | crit | high | med | low | Report |
|---|---|---|---|---|---|
| WhatsApp worker/socket/bridge | 0 | 4 | 6 | 6 | audit/WA.md |
| Message pipeline | 0 | 2 | 4 | 3 | audit/MSG.md |
| Chats/sync/contacts/DB | 0 | 1 | 2 | 5 | audit/DATA.md |
| AI, tools, search | 1 | 2 | 4 | 0 | audit/AI.md |
| Plugin kernel + SDK | 1 | 3 | 6 | 6 | audit/KRN.md |
| App shell, IPC, preload | 0 | 1 | 3 | 4 | audit/APP.md |
| Renderer chat UI | 0 | 2* | 6 | 7 | audit/UICHAT.md |
| Renderer app/AI/modals | 0 | 1 | 4 | 5 | audit/UIAPP.md |
| **Total** | **2** | **16** | **35** | **36** | ~87 unique (a few overlap across slices) |

\* This includes **B-UICHAT-00**, found in the orchestrator baseline and not in the slice report.
`MessageItem.tsx:202` returns early for system/call messages *before* ~20 hooks run. A rendered message
whose type changes (revoke → system, call-log update) makes React throw "rendered fewer hooks".

### 2.2 The two known bugs in `bug.txt`: root causes found

1. **"Reactions are lost in history sync"** (B-MSG-01). `ReactionRepository.bulkSyncReactions` throws away
   every reaction whose target message isn't in the DB *yet*, and never retries it. The target often
   arrives in a later 200-row batch, sync chunk or on-demand page.
2. **"Editing a replied message loses context"** (B-MSG-03/04, plus B-MSG-02/05 for history sync). Baileys 7
   emits every edit twice (a protocol upsert plus `messages.update{editedMessage}`). The second event
   is processed last by code that doesn't unwrap `editedMessage`. It blanks the stored text and drops
   the quote when the edit carries partial `contextInfo`. The edit/quote merge logic exists in **five
   diverging copies**.

### 2.3 Critical / high items (fixed first)

Security (full details in the slice reports):
- **SEC-A** (crit) The AI `executeScript` tool's `vm` sandbox can be escaped to the host through the sandbox
  global's prototype (the S12-03 fix only pinned `constructor`). A synchronous loop freezes the main process,
  because `runInContext` has no V8 timeout. B-AI-01/02
- **SEC-B** (crit) The plugin API can run privileged AI tools (`executeScript`, `queryDatabase`, `sendMessage`)
  through `kernel:ai:callTool` or the `ai-tool` contribution path, with no consent prompt and no chat scope. B-KRN-01/02
- **SEC-C** (high) The `plugin://` handler takes the plugin id from the URL host without validating it.
  `plugin://../dev.db` resolves outside the extensions dir, so any plugin UI can read the DB (which holds the WA creds). B-KRN-03
- **SEC-D** (med) Plugin chat-scope enforcement has gaps: panel events, delete/react, revocation. B-KRN-06/07/10
- **SEC-E** A committed API key. **Owner action: rotate it now.**

Data loss / broken features:
- B-WA-02 Logout wipe always rolls back once the vector table exists, so a device unlinked from the phone stays in a reconnect loop with no QR.
- B-WA-03 The runtime Baileys patcher no longer matches rc13. It throws in dev, and in packaged builds phone-side mute/pin/star never syncs.
- B-WA-01/04 The bridge never learns its own identity (quoted replies to self are broken), and a failed worker `init` is silently dropped.
- B-AI-03 Embedding dim 384 vs a vec table of 768: **semantic search returns nothing**, and rows are marked indexed anyway.
- B-DATA-01 LID↔PN linking leaves contacts permanently split.
- B-MSG-02/06 A duplicate id in a sync batch overwrites rows; a caption edit destroys the media node.
- B-KRN-04 One broken plugin disables the entire plugin system, including uninstall.
- B-APP-01 On macOS, Cmd+Q, Dock → Quit and OS logout are all cancelled when minimize-to-tray is on (the default).
- B-APP-02/03 = B-UIAPP-01 = B-WA-12: renderer channels with no handler (extension chat is dead in production), and
  main→renderer events nobody listens to (`toast`, `wa-disconnected`).
- B-UICHAT-01/02/03 A jump scrambles message order; a send lands in the wrong chat after a switch; staged files are sent to the wrong chat.
- B-UIAPP-04 A transient reconnect unmounts the whole chat UI (drafts, staged files and AI stream are lost).

### 2.4 Code-quality themes (cross-cutting)

1. **No single source of truth at process boundaries.** The IPC contract is hand-copied in four places
   (preload, `index.d.ts`, `IAPIService`, `api.service`) plus a renderer mock; it is untyped in practice and has
   already drifted (12 mismatches). The worker↔main event contract is stringly typed. DTOs are duplicated
   between main and renderer, with drift (`SearchFilters` dates are string vs Date).
2. **Duplicated core logic that has already diverged**: 5× edit/quote merge, 3× chat writers, 2× identity
   merge, 2× participant pipelines, 4× display-name, 3× SQL read-only guards, 3× near-identical OpenAI-compatible
   providers, 2× reaction pipelines, and dead main-process copies of worker code (~475 LOC).
3. **Service locator.** `ServiceContainer` (47 entries) is passed whole to 4 consumers, and a half-built
   `{} as unknown as ServiceContainer` is used during construction. `electron`/`__dirname` are read inside
   factories. Construction can't be done per module in tests.
4. **God files**: `ipcHandlers.ts` (645 LOC, 66 handlers), `MessageItem.tsx` (713), `ReadMessagesTool.ts` (662),
   `MessageService.ts` (632), `PluginHost.ts` (605), `ChatList.tsx` (637), a 250-line `MembershipSyncHandler` method.
5. **Error handling**: swallowed errors at the IPC edge, floating promises in the renderer, and SDK fire-and-forget
   calls that kill plugin workers.
6. **UI**: memoization defeated everywhere (unstable callbacks), an unvirtualized message list, 5 modal
   patterns (2 different `ConfirmModal`s), Tailwind imported but never compiled, duplicated CSS.

### 2.5 Test-quality themes

- **Wiring tests, not behaviour tests.** Services are tested through `vi.fn` repos; `$transaction` is mocked;
  497 `as any` in tests. Several tests **encode the bug as correct**, e.g. `LidPnLinker.test.ts:75` and the
  "preserve quoted contextInfo" test.
- **Vacuous tests.** Two MessageView reaction tests (including the F5-07 regression test) query a class that
  isn't rendered; `if (btn)` guards skip assertions; the renderer mock implements channels main doesn't have.
- **Big untested areas**: `ipcHandlers.ts` and preload (0 tests); the worker↔main bridge contract; on-demand
  history sync (new, 0 tests); `MessageItem` (1 test); `useAIStream` tool/retry paths; `App.tsx` connection states;
  APIServer auth (the test mocks `http` entirely).
- **Infrastructure**: the test DB template has a race and never goes stale-checked; the userData dir leaks outside the
  package; there are no shared factories or reset helper; the global `EmbeddingService` mock hides coupling; there are
  34 real sleeps/`setTimeout` in tests.

---

## 3. Refactor strategy — how we avoid introducing new bugs

Guardrails. Every unit, no exceptions:

1. **Gates before refactoring.** No structural work starts until the suite is green, hermetic and in CI (Wave 0).
2. **Net first.** Before a unit changes a file, characterization tests must pin that file's current behaviour.
   For a bug fix, the first commit is a failing test (`it.fails`), and the fix commit flips it.
3. **Never mix fix and refactor.** A *refactor* commit is behaviour-preserving (tests unchanged and green);
   a *fix* commit changes behaviour and its tests. Separate commits, ideally separate PRs.
4. **Prove the new tests bite.** Each PR states that reverting the fix (or mutating the key line) makes the new test fail.
5. **File ownership + hotspot locks** (§4.2). A unit edits only the files it declares. Other files get only
   mechanical import-path updates.
6. **Contract changes are explicit.** A unit tagged `CONTRACT` (IPC channel, preload API, plugin SDK, DB schema,
   worker message) changes both sides and the contract test in the same PR. DB changes are additive
   `schema-migrations.ts` entries with an upgrade test.
7. **Per-PR gate**: `npm run typecheck` · full `vitest run` (0 failures, 0 unhandled errors) · lint ratchet
   (no rule count may increase) · coverage of owned files must not drop.
8. **Small units** (< ~400 changed non-test, non-move lines), merged quickly so parallel branches stay short-lived.
9. **Human smoke tests.** Units marked 🔎 touch things an agent can't exercise: a real WhatsApp login,
   scrolling feel, macOS quit, packaged builds. They merge to `main` once the gates pass, then queue in
   TRACKER's "🔎 owner smoke queue". The owner runs the batched checks at each wave boundary. A failed check
   reopens the unit, or reverts it if the break is severe.

---

## 4. Execution model (one orchestrator session + subagents; local or cloud)

The owner talks to **one orchestrator Claude Code session**. It follows `refactor/ORCHESTRATOR.md` and does
no implementation itself. It:
- picks the next ready units from §5 and TRACKER (deps merged, no lock conflict);
- launches **one subagent per unit** in its own git worktree (`Agent` tool with `isolation: "worktree"`), up to
  about 6 in parallel, each with the §7 prompt;
- **verifies** each returned branch itself: it re-runs the gates, reads the diff against the unit's declared
  files and the guardrails, and runs the mutation check spot-check;
- merges verified branches into `main` **one at a time** (rebasing the next one and re-running gates after each
  merge), pushes, and updates `TRACKER.md` (it is the only writer);
- escalates to the owner only for 🔎 smoke batches, new product decisions, or a unit that fails verification twice.

### 4.1 Mechanics
- One unit = one subagent = one branch `refactor/<unit-id>`. The orchestrator merges it into `main` after
  verification. If GitHub is available and the owner prefers it, the same branch can go through a PR with CI
  instead. Same gates either way.
- It works in any environment: the gates are plain npm scripts, and the worktrees are local to wherever the
  orchestrator runs. In a cloud session, remember containers are ephemeral: push `main` after every merge.
- A unit starts only when its `deps` are **merged**, not just finished.
- Subagents are stateless. Everything they need is in their prompt plus the files it points to.
  The orchestrator never pastes file contents; it passes paths.
- If the orchestrator's context runs out or the session is lost, a fresh session resumes from
  `ORCHESTRATOR.md` + `TRACKER.md` alone.

### 4.2 Hotspot locks (only one in-flight unit may modify each at a time; the orchestrator enforces this at dispatch)
| Lock | Files |
|---|---|
| `IPC` | `src/main/ipcHandlers.ts`, `src/main/ipc/**` |
| `PRELOAD` | `src/preload/index.ts`, `src/preload/index.d.ts`, `renderer/src/services/{IAPIService,api.service}.ts`, `renderer/tests/mocks/mockApiService.ts` |
| `DI` | `src/main/ServiceContainer.ts`, `src/main/workers/whatsapp/bootstrapWorkerRepositories.ts` |
| `BOOT` | `src/main/index.ts` |
| `SCHEMA` | `prisma/schema.prisma`, `src/main/db/schema-migrations.ts`, `src/main/auth.ts` |
| `WABRIDGE` | `workers/bridge/WAWorkerBridge.ts`, `workers/whatsapp/whatsappWorker.types.ts`, `routing/workerCommandRouter.ts` |
| `WASYNC` | `workers/whatsapp/services/WorkerHistorySyncManager.ts`, `socket/workerConnectionManager.ts` |
| `MSGREPO` | `services/messages/MessageRepository.ts`, `utils/messageUtils.ts` |
| `KHOST` | `kernel/plugins/PluginHost.ts`, `kernel/KernelBootstrapper.ts`, `kernel/ipc/contributionIpc.ts` |
| `USEMSG` | `renderer/.../chat/hooks/useMessages.ts`, `MessageView.tsx`, `ChatLayout.tsx` |

Constructor-signature edits to `DI` files are small. They are allowed without the lock, **merged last** in their batch, and called out in the unit report.

### 4.3 Lanes
`WA` · `MSG` · `DATA` · `AI` · `KRN` · `APP` (shell/IPC/DI) · `UC` (renderer chat) · `UA` (renderer app).
Lanes run in parallel; units inside one lane run in order unless marked ∥.

---

## 5. The plan — waves and units

Legend: **risk** L/M/H · `CONTRACT` = public contract change · 🔎 = needs owner smoke test · refs point into audit/*.md.

### Wave 0 — Gates (mostly serial; blocks everything else) · ~4 sessions

| ID | Unit | Refs | Deps | Risk |
|---|---|---|---|---|
| G-01 | **Hermetic green suite.** Mock LM Studio/network in `AIService.test`/`milestone3`. Replace the `dev_only` fixture with a **synthetic** committed fixture (never commit the real one: it holds personal chats). Add a vitest globalSetup that packs the `.scext` test plugins and aliases `@smartchat/sdk`. Make the path test platform-aware. Fix the test-DB template race and userData path (B-DATA-07/08). Make unhandled rejections fail the run. Target: 0 failures, 0 errors, twice in a row, on Linux and Windows. | R-DATA-01 (part), R-APP-12 | – | L |
| G-02 | **CI workflow** (ubuntu + windows): `npm ci` → `prisma generate` → typecheck → vitest → lint ratchet. Add `@vitest/coverage-v8` (report only). Required status check on `main`. | R-APP-12 | G-01 | L |
| G-03 | **Format + lint baseline.** One `prettier --write` commit plus `.git-blame-ignore-revs`. Commit a per-rule baseline (`scripts/lint-baseline.json`) plus an `npm run lint:ratchet` script that fails if any rule's count rises (CI runs it). `rules-of-hooks`/`exhaustive-deps` must become zero-tolerance as they get fixed. **Merge while no other branch is open** (it touches every file). | – | G-01 | L |
| G-04 | **Repo hygiene + agent guide.** Remove the key from `train/Annotate_Data.ts` (env var). Move `bug-audit*` into `docs/audits/archive/` and `bug.txt` items into the tracker; delete `runWithLogswn.txt`. Add a root **`CLAUDE.md`** with the build/test commands (incl. the native `better-sqlite3` rebuild dance), the guardrails from §3, and the lock table. Add a tiny `logger` module (scoped, levels) that later units adopt. | – | ∥ G-02 | L |

### Wave 1 — Security hotfixes + safety nets (all parallel; disjoint files) · ~20 sessions

Hotfixes are **minimal diffs**: a failing test, then the smallest fix. Structural cleanup of the same code comes later.

| ID | Unit | Refs | Lock | Risk |
|---|---|---|---|---|
| S-01 | Validate `plugin://` host (reject `..`, `.`, unknown ids; resolve against installed ids) | B-KRN-03, R-KRN-03 | – | L |
| S-02 | `executeScript` isolation. Step 1 (same PR): V8 `timeout` + null-prototype context + tests for both escape classes. Step 2: run scripts in a separate process/worker with no host bindings (decision D2) | B-AI-01/02, R-AI-01 | – | H |
| S-03 | Gate plugin → AI tool calls: consent prompt + chat scope for `callTool` and for the `ai-tool` contribution path | B-KRN-01/02, R-KRN-02 | KHOST | M |
| S-04 | Plugin scope enforcement: one `EventDeliveryPolicy` used by events + panels; delete/react check the message's real chat; revocation tears down live subscriptions | B-KRN-06/07/10, R-KRN-06 | – | M |
| H-01 | `MessageItem` hooks-order crash: move the system-message branch into a wrapper component so hooks are unconditional | B-UICHAT-00 | – | L |
| H-02 | Logout/wipe loop + `saveCreds` swallowing 🔎 | B-WA-02/05, R-WA-02 | WASYNC | M |
| H-03 | Replace the runtime BaileysPatcher with `patch-package` patches for rc13 🔎 | B-WA-03, R-WA-03 | BOOT | M |
| H-04 | Vector dimension: a single constant, recreate the vec table, re-index path `CONTRACT` (vec schema) | B-AI-03, R-AI-02 | SCHEMA | M |
| H-05 | macOS quit/activate/window-null (minimal, in `index.ts`) 🔎 | B-APP-01/05/06 | BOOT (after H-03) | L |
| H-06 | Kernel boot: per-plugin try/catch; a failed plugin is listed as failed instead of killing boot | B-KRN-04 | KHOST (after S-03) | L |
| N-01 | Main test infra: schema-hash template, `resetDb()`, shared factories (`tests/factories/*`) | R-DATA-01 | – | L |
| N-02 | WA worker↔main contract characterization + `waFakes` | R-WA-01 | – | L |
| N-03 | Edit/reaction flow characterization against real DB (bug.txt cases as `it.fails`) | R-MSG-01 | – (after N-01) | L |
| N-04 | Identity-linking + MembershipSync integration tests (real DB) | R-DATA-02, R-DATA-04 | – (after N-01) | L |
| N-05 | IPC contract-drift test + recording `ipcMain` in electron mock; handler-level tests | R-APP-01 | – | L |
| N-06 | Kernel test harness `createTestKernel` + real-worker fixture | R-KRN-01 | – | L |
| N-07 | Renderer test infra: mock `emit.*` helpers, `makeMessage/makeChat` factories, fix vacuous tests, `afterEach` resets | R-UICHAT-01, R-UIAPP-03 (untyped part) | PRELOAD (mock only) | L |
| N-08 | Characterization: `useMessages` paging/jump/on-demand, `useAIStream` tool/retry/decline, `App` connection states, `MessageItem` actions | R-UICHAT-02/06, R-UIAPP-05/08 (tests only) | – (after N-07) | L |
| N-09 | Provider role-mapping/stream-reassembly tests through a shared util (incl. a Gemini case) | R-AI-03 (tests) | – | L |
| X-01 | Delete dead main-process twins of worker code (`HistorySyncManager`, `WAEventWiringService`, `WACatchUpManager` + tests) | R-WA-07, B-WA-15 | DI | L |

### Wave 2 — Correctness fixes, by lane (lanes parallel; each fix = failing test → fix) · ~29 sessions

| Lane | Order | Units |
|---|---|---|
| **MSG** | F-MSG-1 → F-MSG-2 → F-MSG-3; F-MSG-4 ∥; F-MSG-5 ∥ | **F-MSG-1** single pure `applyEdit/mergeContextInfo`, used by all 5 call sites (B-MSG-03/04/06, R-MSG-02) 🔎 · **F-MSG-2** stop double-processing edits (R-MSG-03) · **F-MSG-3** batch-safe `bulkSyncMessages`, monotonic flags, in-batch dedupe (B-MSG-02/05/08/09, R-MSG-04) · **F-MSG-4** deferred reactions for sync (B-MSG-01, R-MSG-05; needs WASYNC after F-WA-2) · **F-MSG-5** single reaction pipeline (R-MSG-06) |
| **WA** | F-WA-2 → F-WA-3; F-WA-4 ∥; F-WA-5 ∥ | **F-WA-1** self identity + init supervision (B-WA-01/04, R-WA-04; its `wa-disconnected` preload part moves to C-04) · **F-WA-2** history-sync state machine (B-WA-06/11/13/16, R-WA-06) 🔎 · **F-WA-3** graceful worker shutdown (B-WA-09, R-WA-05) · **F-WA-4** group-metadata cache (B-WA-08, R-WA-10) · **F-WA-5** encrypted-reaction attribution + embedding-worker races (B-WA-07/10, R-WA-11) |
| **DATA** | F-DATA-1 ∥ F-DATA-2 → F-DATA-3 | **F-DATA-1** one identity-merge implementation, fixes the split (B-DATA-01, R-DATA-03) · **F-DATA-2** MembershipSync: carry derived PN, prune departed members (B-DATA-02/03, R-DATA-05) 🔎 · **F-DATA-3** live participant sync through the batched path (R-DATA-06) · plus the small ones B-DATA-04/05/06 folded into these |
| **AI** | all ∥ | **F-AI-1** `BaseOpenAICompatibleProvider` + Gemini role mapping (B-AI-04, R-AI-03) · **F-AI-2** citation FK/cascade `CONTRACT`(schema) (B-AI-05, R-AI-05) · **F-AI-3** abort-id leak + anchored name regex (B-AI-06/07) · **F-AI-4** tool loop: move the turn cap into the live renderer loop, or move the loop to main (design note in audit/AI.md §2) |
| **KRN** | F-KRN-1 → F-KRN-2 → F-KRN-3; F-KRN-4 ∥ | **F-KRN-1** worker crash handling + SDK rejection hygiene (B-KRN-05/13, R-KRN-04) · **F-KRN-2** resilient install/uninstall/load races (B-KRN-09/14/15/16, R-KRN-05) · **F-KRN-3** overlay lifecycle per plugin (B-KRN-08, R-KRN-08) · **F-KRN-4** JID normalisation in the permission scope (B-KRN-11, R-KRN-07) |
| **APP** | ∥ | **F-APP-1** APIServer `error` listener + real-http auth tests (B-APP-07, R-APP-10) · **F-APP-2** surface `index-embeddings` failures (B-APP-04, R-APP-11; IPC lock, must land before C-02) |
| **UC** | F-UC-1 → F-UC-2; F-UC-3 ∥ | **F-UC-1** cursor pagination + `loadNewer` + chat-guarded sends `CONTRACT`(`messages:get`) (B-UICHAT-01/02/07, R-UICHAT-02) 🔎 · **F-UC-2** chat-switch hygiene (B-UICHAT-03/05/12, R-UICHAT-05) · **F-UC-3** composer/markdown/error toasts (B-UICHAT-04/08–11/13/14, R-UICHAT-09) |
| **UA** | ∥ | **F-UA-1** small renderer batch (B-UIAPP-02/05–10, R-UIAPP-07) · **F-UA-2** `useAIStream` session guard (B-UIAPP-03) · **F-UA-3** `useConnectionState` reducer; keep `ready` on reconnect (B-UIAPP-04, R-UIAPP-08) 🔎 |

### Wave 3 — Contract spine (two serial chains, parallel with late Wave-2 lanes) · ~11 sessions

**IPC chain** (locks IPC → PRELOAD):
- **C-01** `src/shared/ipc/contract.ts` (`InvokeMap`/`SendMap`/`EventMap`) + shared DTOs; fix the broken `index.d.ts` import. Types only. (R-APP-02, R-UIAPP-01 type part)
- **C-02** typed `handle<K>()` registration; split `ipcHandlers.ts` into `ipc/handlers/<domain>.ts`, each taking a `Pick<>` of deps. Pure move. (R-APP-03)
- **C-03** typed preload built from the contract; `IAPIService = RendererApi`; typed mock; remove every `as any`. Fix the mismatches this surfaces, one commit each. `CONTRACT`(types) (R-APP-04, R-UIAPP-01, R-UIAPP-03 rest)
- **C-04** resolve orphan channels: extension chat (decision D1), add `onToast`/`onWaDisconnected`, delete dead handlers, retire `syncFullHistory`. The contract test flips to strict. `CONTRACT` (R-APP-05, R-UIAPP-04/11, R-WA-13, B-APP-08)
- **C-05** panels use the service layer; no direct `window.api` outside `api.service.ts` (R-UIAPP-02)
- **C-06** move duplicated DTOs to `src/shared/types` (R-UIAPP-09)

**DI chain** (lock DI → BOOT):
- **D-01** drop the `{} as unknown as ServiceContainer` hack; inject `AppEnv` (paths) instead of reading `electron`/`__dirname` (R-APP-06)
- **D-02** per-layer factories (`createRepositories`, `createMessagingModule`, …); `ServiceContainer` becomes their intersection (R-APP-07)
- **D-03** consumers declare narrow `Pick<>` deps; the locator stops being passed around (R-APP-08)
- **D-04** split `auth.ts` → `db/prismaClient.ts` + `db/vectorStore.ts`; inject prisma into tools (R-APP-13)
- **D-05** extract `AppLifecycle`/`windowFactory`/`webviewHardening` from `index.ts` with tests (R-APP-09 remainder) 🔎

### Wave 4 — Structural refactors per lane (parallel; behaviour-preserving) · ~23 sessions

| Lane | Units |
|---|---|
| WA | R-WA-08 typed worker event map · R-WA-09 table-driven command router · R-WA-12 one login/wipe policy (H) 🔎 |
| MSG | R-MSG-07 split `MessageService` (read/ingest facades) · R-MSG-08 one parser/`extractTextContent` · R-MSG-09 media/sticker infra (paths port, atomic writes) · R-MSG-10 last-message window query + dead code |
| DATA | R-DATA-07 single chat-update normalizer · R-DATA-08 chat-list batching (~200 → ≤5 queries/page) · R-DATA-09 contact cache/`MeJidProvider`, one `getDisplayName` · R-DATA-10 index migration `CONTRACT`(schema) · R-DATA-11 dead code + narrow catches |
| AI | R-AI-04 one read-only-SQL guard · R-AI-06 `PromptAssembler` out of `AIService` |
| KRN | R-KRN-09 builtin context from the SDK bridge · R-KRN-10 single manifest schema `CONTRACT` · R-KRN-11 SDK contract cleanup `CONTRACT`(SDK) + docs |
| UC | R-UICHAT-03 stable callbacks/memo, `SelfJidContext` → R-UICHAT-06 split `MessageItem` → R-UICHAT-04 virtualize `MessageView` (H) 🔎 · R-UICHAT-07 `useChats`/hierarchy dedupe ∥ · R-UICHAT-08 split `ChatList` ∥ |
| UA | R-UIAPP-06 modal consolidation (one `BaseModal`, rename plugin modals) |

### Wave 5 — Cleanup & ratchet to zero · ~8 sessions (highly parallel, by directory)
- **Z-01..04** adopt `logger` in place of `console.*` (split by main/services, main/kernel+workers, renderer, sdk)
- **Z-05** `no-explicit-any` burn-down per lane until lint has 0 errors; then CI goes strict (no baseline)
- **Z-06** CSS: remove Tailwind (decision D4), dedupe selectors/keyframes (R-UIAPP-10, R-UICHAT-10) 🔎 before/after screenshots
- **Z-07** dead-code sweep (`ts-prune`/knip) + stale comments
- **Z-08** docs: update `docs/architecture/*`, ADRs for the IPC contract, DI and worker contract; refresh `CLAUDE.md`

### Schedule at a glance
```
Wave 0  G-01 ─► G-02 ∥ G-04 ─► G-03 (freeze window)
Wave 1  S-01 S-02 S-03 S-04 H-01..H-06 X-01 N-01..N-09          (≈6 parallel subagents)
Wave 2  lanes MSG | WA | DATA | AI | KRN | APP | UC | UA          (≈6-8 parallel)
Wave 3  IPC chain C-01..C-06  ∥  DI chain D-01..D-05  ∥ rest of wave 2
Wave 4  lanes again                                               (≈6-8 parallel)
Wave 5  Z-01..Z-08                                                (≈6 parallel)
```
Total ≈ **95 units** (4 + 20 + 29 + 11 + 23 + 8) before the SOLID additions in §5.1. At ~6 concurrent subagents, that's roughly 15–18 dispatch rounds. The longest
serial chain is G-01 → G-03 → N-07 → N-08 → F-UC-1 → R-UICHAT-03 → R-UICHAT-06 → R-UICHAT-04.

---

## 6. Decisions (decided 2026-09-30 — owner accepted every recommendation)

| # | Decision | Outcome |
|---|---|---|
| D1 | Extension-chat / docs / live-log UI has no backend | **Delete** it (in C-04); re-add behind a real contract later if wanted |
| D2 | `executeScript` tool | **Hotfix now (S-02 step 1), then move to an isolated child process** with no host bindings and a hard timeout (S-02 step 2) |
| D3 | Cursor pagination changes `messages:get` | **Yes**, in F-UC-1 |
| D4 | Tailwind is imported but not compiled | **Remove** it (Z-06); convert the ~10 utility usages to CSS |
| D5 | Where work lands | **Short-lived `refactor/<id>` branches merged into `main`** after the orchestrator's gate verification (or a PR, if GitHub is available and preferred) |
| D6 | Who runs units | **One orchestrator session launches subagents** (§4, `ORCHESTRATOR.md`); the owner runs the batched 🔎 smoke checks |
| D7 | Public repo disclosure | Owner: the app has no users yet, so **commit everything, security details included** |
| D8 | Message-list virtualization | Add `react-virtuoso` (or an equivalent) in R-UICHAT-04 |
| D9 | Worker plugins run with full Node access by design | Out of scope. Document it in the SDK docs (R-KRN-11) |

---

## 7. Subagent prompt template (the orchestrator fills the `<…>`)

```
You are implementing refactor unit <ID> — "<title>" — for SmartChat. Repo root: smartchat/.
You are working in an isolated git worktree on branch refactor/<ID>, created from main @ <sha>.

Read first (paths, not pasted): CLAUDE.md; refactor/PLAN.md §3 (guardrails) and §4.2 (locks);
your unit's row in PLAN.md §5; the referenced sections of refactor/audit/<SLICE>.md (<ids>).

Files you own: <list>. Locks held: <locks>.
You may make mechanical import-path updates elsewhere; nothing else. No public contract change
unless this unit is tagged CONTRACT (then change both sides + the contract test).

Procedure:
1. Run the baseline gates (`npm run typecheck`, `npx vitest run`, `npm run lint:ratchet`); record the results.
2. Add or extend characterization tests. For a fix, add a failing test first (it.fails) and commit it.
3. Implement. Use separate commits for refactor (behaviour-preserving) and fix (behaviour change).
4. Show that the new tests bite: mutate or revert the key line, see the failure, restore.
5. Re-run all gates until they are clean. Commit (conventional message, prefixed "<ID>:"). Don't merge, don't push.

Final report (exact format):
- Unit / branch / head sha
- Files changed (flag any outside your ownership list, with the reason)
- Tests added/changed
- Gates: typecheck | vitest (pass/fail/errors counts) | lint ratchet
- Mutation check: what you mutated, which test failed
- Contract changes: none | details
- 🔎 Owner smoke steps: none | numbered steps
- Follow-ups found (out of scope; not fixed)
- Blockers / uncertainty
```

## 8. Definition of done (whole refactor)
- CI on ubuntu + windows: typecheck, **0 lint errors** (no baseline), vitest with 0 failures and 0 unhandled errors.
- All crit/high/med bugs closed with regression tests; each low one is closed or explicitly accepted.
- One typed IPC contract (the drift test is strict); one typed worker event contract; no `as any` in `src/`.
- `ServiceContainer` is no longer passed to consumers; every module is constructible in tests with fakes.
- No duplicated core logic from §2.4 remains; god files are split to < ~350 LOC.
- Docs/ADRs updated; `CLAUDE.md` current.
