# Refactor tracker

Only the orchestrator edits this file (see `ORCHESTRATOR.md`).
Statuses: `READY` (deps met) · `WAITING` (deps pending) · `IN PROGRESS` · `REVIEW` (returned, being verified) ·
`MERGED` · `BLOCKED` · `DROPPED`.
Deps refer to unit ids; "W0" means all Wave-0 units are merged. Locks: see PLAN §4.2.

## Current state
- Wave: **1 (in progress; Wave 0 complete)**
- Locks held: WASYNC (H-02) · BOOT (H-03) · SCHEMA (H-04) · DI (X-01) · PRELOAD-mock (N-07). **Owner scope: only H-02, H-03, H-04, X-01, N-06, N-07, N-09 — no other unit after these.**
- `main` baseline: typecheck ✅ · vitest 242 files / 1227 passed / 2 skipped / 0 failed / 0 errors (hermetic, after G-01) · lint ratchet baseline committed (scripts/lint-baseline.json, 22 rules, Prettier excluded): no-explicit-any 897 · explicit-function-return-type 430 · no-restricted-imports 107 · rules-of-hooks 22 · exhaustive-deps 22

## Owner smoke queue (🔎)
3. (S-02) Dev/packaged Electron: an AI chat executeScript call (e.g. queryDatabase) returns results + logs; a `while(true){}` script leaves the app responsive and times out (~60s). Child is spawned via process.execPath -e with ELECTRON_RUN_AS_NODE=1: untested under real Electron.
4. (S-03) In `npm run dev`, a plugin with ai:tools:call calls ctx.ai.callTool('sendMessage',{jid,text}): dialog appears; Cancel→PERMISSION_DENIED, Allow→sends. In devtools window.api.executeContribution({slot:'ai-tool',...}) rejects. Main AI chat tools still work.
5. (S-04, optional) Untick events:* for a plugin in Settings: its panel/worker stops receiving events without reload.
2. (S-01) In a real Electron build: a plugin panel/overlay still renders; from a plugin page devtools `fetch('plugin://../dev.db')` is denied (403).
1. After pushing, check GitHub Actions: CI workflow green on ubuntu AND windows (windows untested); then mark both checks required on main (Settings > Branches).

## Follow-ups inbox (triaged at each wave boundary)
- (G-04) Gemini key `AIzaSy…YLRGd0` is in git history: OWNER must rotate it. Audit docs may have stale paths to moved `bug-audit*`; `.agents/skills/feature-and-bugfix/SKILL.md` mentions bug files; logger lives at `src/main/utils/logger.ts` (relocate if a shared dir appears); `test:run` and `test:run:all` scripts are identical. Fold into Z-08 (docs).
- (G-01) codetantra plugin manifest fails SDK `validateManifest` (globalSetup zips it plainly) → fold into R-KRN-10. `packages/sdk` dist is gitignored; CI must build it (globalSetup does for tests; `plugin:package:*` assumes prior build). `AIService` eagerly constructs `LMStudioProvider` (lazy-connect later, AI lane). `src/main/index.ts:37` references `dev_only/logs` (BOOT, fold into D-05). ipcGuards win32 branch untested until Windows CI. milestone2 unreadCount expectation corrected 0→5 (ChatSyncHandler.ts:76 persists provided value). G-01 rewrote smartchat/.gitignore line endings (CRLF→LF), harmless.
- (G-02) Flaky unhandled 'Cannot find module …/index.js' in kernel/e2e/panel-plugin.test.ts (worker starts after temp dir cleanup), seen under coverage; create a fix unit in KRN lane (candidate: N-06/F-KRN-1). CI uses `npm ci --legacy-peer-deps` (npm arborist crash on lockfile; same as build-mac.yml); Node 22. G-03 must add lint-ratchet step at TODO(G-03) in .github/workflows/ci.yml. 🔎 owner: after first CI run, require checks 'Typecheck + tests (ubuntu-latest)' and '(windows-latest)' on main; confirm windows job green.
- (G-03) Ratchet lints `.` (~40s, --no-cache); a local `coverage/` dir could add counts → add `coverage` to eslint ignores (fold into Z-05). 3 null-ruleId results counted as `(no-rule)`. Ratchet untested on Windows until CI. **Triage (end of Wave 0):** flaky panel-plugin e2e → fold into N-06; codetantra manifest → R-KRN-10; `dev_only/logs` ref in index.ts → D-05; LMStudioProvider eager construct → F-AI-1; stale bug-audit paths/skill docs → Z-08; `plugin:package:*` needs prebuilt sdk dist → Z-08 docs; test:run dup scripts → Z-08.
- (S-01) NOT done by S-01 (host regex+`..` rejection only): resolve host against installed ids (handler only gets extensionsPath) and restrict `plugin://<otherId>` to the requesting partition (`persist:plugin-<id>`) per R-KRN-03 → fold into F-KRN-4's lane as new unit F-KRN-5 (needs registerPluginProtocolForSession signature change); `Access-Control-Allow-Origin: *` still set on plugin responses (include in F-KRN-5).
- (H-01) PLAN B-UICHAT-00 wording is wrong: on React 19.2 a type flip does NOT throw 'fewer hooks'; it silently skips effect cleanups (leaked document mousedown listener, isMountedRef) and resets state. Fix still valid. rules-of-hooks baseline now 1 (remaining one elsewhere) → fix in a later UC/UA unit and flip to zero-tolerance.
- (S-02) executeScript child is still plain Node with an inner vm soft boundary: a vm escape reaches fs/child_process in an empty-env child → consider Node --permission / OS sandbox (new unit S-05, AI lane, after N-09). ~50–100ms startup per call; non-serialisable results become script errors; stray console.log in ExecuteScriptTool.initialize (Z-01).
- (S-03) Default consent dialog lives inside KernelAIModule → inject from KernelBootstrapper (fold into H-06/R-KRN-09, KHOST). ai-assistant builtin handlers still call tool.execute directly (now unreachable from renderer IPC; revisit R-SOLID-M-02). Gated tools without args.jid (executeScript, queryDatabase) get consent only, no chat scope. Chat-scope semantics = messages:read for readMessages, else messages:send on args.jid (owner may override). Plugin-registered ai-tools are requiresPermission:false (unchanged).
- (S-04) Revocation = drop at delivery, handlers stay attached (regrant resumes without resubscribe); real teardown needs permission-store hook → F-KRN-3/R-SOLID-M-02. KernelEventsModule.unsubscribe while bus null leaves entry (KRN.md:148) → F-KRN-1. B-KRN-11 LID alias bypass → F-KRN-4 (or R-KRN-07). Possible rare flake: 'Errors 1' seen once in a full vitest run under load (unreproduced).
- (H-06) extension:list has isLoaded:false but no failure reason → R-KRN-05/F-KRN-2 (add error field). Failed plugin keeps its registerPluginManifest registration; verify PluginHost cleans up partial activation (F-KRN-2). extensionInstallHandler has the same unguarded host.load (B-KRN-09, IPC lock) → F-KRN-2.
- (N-01) 11 other repository tests still use hand-rolled deleteMany → migrate to resetDb in later units; helpers.ts has `any` in createMockSocket/createTestServiceContainer/injectEvent (ratchet debt); per-worker userData path outside repo not audited. (flake) 3rd sighting of an intermittent single unhandled error in a full vitest run (seen on S-04, H-01, H-06 post-merge; always clean on re-run; panel-plugin e2e worker-start race is a known cause) → fix in N-06; until then a lone 'Errors 1' that disappears on re-run is treated as this flake.
- (N-05) Drift allow-lists (strict equality, can only shrink): C-04 removes extension:chat-*/get-docs/ping/extension:chat-push/focus/toast/wa-disconnected/aiChat etc.; C-03 removes IAPIService gaps (getPanelPreloadPath, notifyPanelClosed, onPanelClose/Open). Follow-ups: execute-tool dialog path untested (no `dialog` in electron mock); ai-chat-stream ipcMain.on has no isTrustedSender check (→ F-AI-3/C-02); contract test is regex-based (literal channels only).
- (N-02) Pinned known WA bugs as it.fails: B-WA-04 (init failure not treated as worker death), B-WA-01 (user not set from wa-me event), B-WA-13 (skipSync ignores {status:'deferred'}), B-WA-15 (groupFetchAllParticipating type) → flipped by F-WA-1/F-WA-2/F-WA-4 (remove .fails when fixed). eslint `**/utils` no-restricted-imports also flags legitimate sibling imports (../utils/workerUtils) → narrow the pattern in Z-05. waFakes at src/main/tests/helpers/waFakes.ts.
- (seed) `bug.txt` items are tracked as B-MSG-01 (reactions in history sync) and B-MSG-02..05 (edited reply loses context).

## Session log
| Date | Session | Notes |
|---|---|---|
| 2026-09-30 | audit | Audit + plan committed. No units started. |
| 2026-10-01 | orch-2 | Baseline: typecheck ✅; vitest 248 files pass / 4 fail (kernel e2e timeouts under load: voice-transcriber-overlay 36s, test-all-features 11s; passes in isolation = load flake on this machine). Dispatched H-02, H-03, H-04, X-01, N-06, N-07; N-09 next when a slot frees. |
| 2026-10-01 | orch-1 (Wave 0 done) | G-02, G-03 merged; ratchet baseline committed; main: typecheck ✅, vitest 243 files/1232 pass/0 fail/0 err. Awaiting owner OK for Wave 1. |
| 2026-10-01 | orch-1 (G-01 done) | G-01 and G-04 merged; suite green twice. |
| 2026-10-01 | orch-1 | Baseline reproduced: typecheck ✅, vitest 6 fail / 85 errors. Env note: `npm ci` needs `ELECTRON_SKIP_BINARY_DOWNLOAD=1` here; run `node_modules/.bin/prisma generate` and `npm rebuild better-sqlite3` AFTER npm ci. Owner decision: Prettier out of scope (G-03 reduced to lint baseline, prettier rule excluded). |

---

## Units

| ID | Wave · lane | Title | Deps | Locks | Status | Branch / merge sha |
|---|---|---|---|---|---|---|
| G-01 | W0 | Hermetic green suite | – | – | MERGED | 0d52a54 |
| G-02 | W0 | CI workflow (ubuntu + windows) | G-01 | – | MERGED | 355e7ca |
| G-04 | W0 | Repo hygiene, CLAUDE.md, key → env, logger module | – | – | MERGED | eb206db |
| G-03 | W0 | Lint baseline/`lint:ratchet` (Prettier excluded; no mass format) | G-01, G-02, G-04 | – | MERGED | 7f6c8c9 | |
| S-01 | W1 · KRN | Validate `plugin://` host | W0 | – | MERGED | 929e7a3 |
| S-02 | W1 · AI | executeScript isolation (hotfix → child process) | W0 | – | MERGED | e5ca7d8 |
| S-03 | W1 · KRN | Gate plugin → AI tool calls | W0 | KHOST | MERGED | d42c4b8 |
| S-04 | W1 · KRN | EventDeliveryPolicy + scope enforcement | W0 | – | MERGED | f3d493f |
| H-01 | W1 · UC | MessageItem hooks-order crash | W0 | – | MERGED | 98ee4cc |
| H-02 | W1 · WA | Logout/wipe loop + saveCreds 🔎 | W0 | WASYNC | IN PROGRESS | refactor/H-02 |
| H-03 | W1 · WA | BaileysPatcher → patch-package 🔎 | W0 | BOOT | IN PROGRESS | refactor/H-03 |
| H-04 | W1 · AI | Vector dimension unify + reindex `CONTRACT` | W0 | SCHEMA | IN PROGRESS | refactor/H-04 |
| H-05 | W1 · APP | macOS quit/activate/window 🔎 | W0, H-03 | BOOT | WAITING | |
| H-06 | W1 · KRN | Per-plugin boot isolation | W0, S-03 | KHOST | MERGED | fae5b34 |
| X-01 | W1 · WA | Delete dead main-process worker twins | W0 | DI | IN PROGRESS | refactor/X-01 |
| N-01 | W1 · DATA | Main test infra + factories | W0 | – | MERGED | ae1a3c8 |
| N-02 | W1 · WA | Worker↔main contract characterization | W0 | – | MERGED | 21bbcf7 |
| N-03 | W1 · MSG | Edit/reaction flow characterization | N-01 | – | MERGED | ae1a3c8 |
| N-04 | W1 · DATA | Identity + MembershipSync integration tests | N-01 | – | MERGED | ae1a3c8 |
| N-05 | W1 · APP | IPC contract-drift test + recording ipcMain | W0 | – | MERGED | 17c3268 |
| N-06 | W1 · KRN | Kernel test harness | W0 | – | IN PROGRESS | refactor/N-06 |
| N-07 | W1 · UC | Renderer test infra (emit helpers, factories, vacuous tests) | W0 | PRELOAD | IN PROGRESS | refactor/N-07 |
| N-08 | W1 · UC/UA | Renderer characterization (useMessages, useAIStream, App, MessageItem) | N-07 | – | WAITING | |
| N-09 | W1 · AI | Provider test util + role-mapping tests | W0 | – | WAITING | |
| F-MSG-1 | W2 · MSG | Single `applyEdit/mergeContextInfo` 🔎 | N-03 | MSGREPO | WAITING | |
| F-MSG-2 | W2 · MSG | Stop double-processing edits | F-MSG-1 | – | WAITING | |
| F-MSG-3 | W2 · MSG | Batch-safe bulkSyncMessages | F-MSG-2 | MSGREPO | WAITING | |
| F-MSG-4 | W2 · MSG | Deferred reactions in sync | N-03, F-WA-2 | WASYNC | WAITING | |
| F-MSG-5 | W2 · MSG | Single reaction pipeline | N-03 | – | WAITING | |
| R-SOLID-M-13 | W2 · MSG | Honest write contracts (fix) | F-MSG-3, F-MSG-4, H-02 | MSGREPO | WAITING | |
| F-WA-1 | W2 · WA | Self identity + init supervision | N-02 | WABRIDGE | MERGED | 21bbcf7 |
| F-WA-2 | W2 · WA | History-sync state machine 🔎 | N-02, H-02 | WASYNC | WAITING | |
| F-WA-3 | W2 · WA | Graceful worker shutdown | F-WA-1, F-WA-2 | WABRIDGE | WAITING | |
| F-WA-4 | W2 · WA | Group-metadata cache | N-02, F-WA-2 | WASYNC | WAITING | |
| F-WA-5 | W2 · WA | Encrypted-reaction attribution + embedding races | N-02 | – | MERGED | 21bbcf7 |
| F-DATA-1 | W2 · DATA | One identity-merge implementation | N-04 | DI | WAITING | |
| F-DATA-2 | W2 · DATA | MembershipSync PN carry + prune 🔎 | N-04 | – | WAITING | |
| F-DATA-3 | W2 · DATA | Live participant sync via batched path | F-DATA-2 | – | WAITING | |
| F-AI-1 | W2 · AI | BaseOpenAICompatibleProvider + Gemini roles | N-09 | – | WAITING | |
| F-AI-2 | W2 · AI | Citation FK/cascade `CONTRACT` | N-01 | SCHEMA | MERGED | ae1a3c8 |
| F-AI-3 | W2 · AI | Abort-id leak + anchored regex | N-09 | IPC | WAITING | |
| F-AI-4 | W2 · AI | Tool-loop turn cap in the live loop | N-08 | – | WAITING | |
| F-AI-5 | W2 · AI | Preferences clobber + `set-ai-options` whitelist | W0 | IPC | WAITING | |
| F-KRN-1 | W2 · KRN | Worker crash + SDK rejection hygiene | N-06 | KHOST | WAITING | |
| F-KRN-2 | W2 · KRN | Resilient install/uninstall/load | F-KRN-1, H-06 | KHOST | WAITING | |
| F-KRN-3 | W2 · KRN | Overlay lifecycle per plugin | F-KRN-2 | KHOST | WAITING | |
| F-KRN-4 | W2 · KRN | JID normalisation in permission scope | S-04 | – | MERGED | f3d493f |
| F-APP-1 | W2 · APP | APIServer error listener + real-http tests | W0 | – | WAITING | |
| F-APP-2 | W2 · APP | Surface index-embeddings failures | N-05, H-04 | IPC | WAITING | |
| F-UC-1 | W2 · UC | Cursor pagination + loadNewer + guarded sends `CONTRACT` 🔎 | N-08 | USEMSG, IPC, PRELOAD | WAITING | |
| F-UC-2 | W2 · UC | Chat-switch hygiene | F-UC-1 | USEMSG | WAITING | |
| F-UC-3 | W2 · UC | Composer/markdown/error toasts | N-07 | – | WAITING | |
| F-UA-1 | W2 · UA | Small renderer bug batch | N-07 | – | WAITING | |
| F-UA-2 | W2 · UA | useAIStream session guard | N-08 | – | WAITING | |
| F-UA-3 | W2 · UA | useConnectionState reducer 🔎 | N-08 | – | WAITING | |
| C-01 | W3 · APP | Shared typed IPC contract (types only) | N-05, F-UC-1, F-AI-3, F-AI-5, F-APP-2 | IPC | WAITING | |
| C-02 | W3 · APP | Typed registration; split ipcHandlers | C-01 | IPC | WAITING | |
| C-03 | W3 · APP | Typed preload + IAPIService + typed mock | C-02 | PRELOAD | WAITING | |
| C-04 | W3 · APP | Orphan channels, delete extension chat, retire syncFullHistory `CONTRACT` | C-03, F-WA-1 | IPC, PRELOAD | WAITING | |
| C-05 | W3 · UA | Panels through service layer | C-03 | PRELOAD | WAITING | |
| C-06 | W3 · UA | Shared DTO types | C-03 | – | WAITING | |
| R-SOLID-R-10 | W3 · UA | RendererApi facets + mute/pin menu items | C-04 | PRELOAD | WAITING | |
| D-01 | W3 · APP | Drop partial-container hack; AppEnv | X-01, F-DATA-1 | DI, BOOT | WAITING | |
| D-02 | W3 · APP | Per-layer factories | D-01 | DI | WAITING | |
| D-03 | W3 · APP | Narrow consumers off the locator | D-02 | DI, BOOT | WAITING | |
| D-04 | W3 · APP | Split auth.ts → db/prismaClient + vectorStore | D-01, H-04 | SCHEMA, DI | WAITING | |
| D-05 | W3 · APP | AppLifecycle extraction 🔎 | H-05, D-03 | BOOT | WAITING | |
| R-WA-08 | W4 · WA | Typed worker event map | F-WA-1, F-WA-2 | WABRIDGE | WAITING | |
| R-WA-09 | W4 · WA | Table-driven command router | F-WA-3 | WABRIDGE | WAITING | |
| R-WA-12 | W4 · WA | One login/wipe policy 🔎 | H-02, X-01 | WASYNC | WAITING | |
| R-SOLID-M-03 | W4 · WA | WA event dispatch table + split WAEventHandler 🔎 | R-WA-08, F-MSG-2, R-MSG-08, R-MSG-10 | DI | WAITING | |
| R-SOLID-M-11 | W4 · WA | Worker-bootstrap role interfaces | R-WA-09, R-MSG-07, R-SOLID-M-03 | DI, WABRIDGE | WAITING | |
| R-SOLID-M-10 | W4 · WA | Honest socket ports | R-MSG-09, C-02 | – | WAITING | |
| R-MSG-07 | W4 · MSG | Split MessageService | F-MSG-3, F-MSG-5 | DI | WAITING | |
| R-MSG-08 | W4 · MSG | One parser / extractTextContent | F-MSG-3 | MSGREPO | WAITING | |
| R-MSG-09 | W4 · MSG | Media/sticker infra | W1 | – | WAITING | |
| R-MSG-10 | W4 · MSG | Last-message window query + dead code | R-DATA-09 | – | WAITING | |
| R-SOLID-M-07 | W4 · MSG | Message-type enrichment strategies | R-MSG-07 | – | WAITING | |
| R-SOLID-M-14 | W4 · MSG | Drop send passthroughs | F-MSG-1, F-MSG-5, F-KRN-4, C-02 | – | WAITING | |
| R-DATA-07 | W4 · DATA | Single chat-update normalizer | N-04 | – | WAITING | |
| R-DATA-08 | W4 · DATA | Chat-list batching | N-01 | – | MERGED | ae1a3c8 |
| R-DATA-09 | W4 · DATA | Contact cache / MeJidProvider / one getDisplayName | F-DATA-1 | DI | WAITING | |
| R-DATA-10 | W4 · DATA | Index migration `CONTRACT` | N-01, F-AI-2 | SCHEMA | WAITING | |
| R-DATA-11 | W4 · DATA | Dead code + narrow catches | R-DATA-07 | – | WAITING | |
| R-SOLID-M-06 | W4 · DATA | Segregate ISyncRepository | F-DATA-2, R-DATA-07 | – | WAITING | |
| R-SOLID-M-12 | W4 · DATA | Repos for raw-Prisma services | F-AI-2, F-WA-5, R-SOLID-M-04 | DI | WAITING | |
| R-AI-04 | W4 · AI | One read-only-SQL guard | W1 | – | WAITING | |
| R-AI-06 | W4 · AI | PromptAssembler | F-AI-3 | – | WAITING | |
| R-SOLID-M-04 | W4 · AI | JsonPreferencesStore port 🔎 | D-01, F-AI-2, F-AI-5 | – | WAITING | |
| R-SOLID-M-01 | W4 · AI | Provider registry + single contract | F-AI-1, R-AI-06, F-AI-3 | DI | WAITING | |
| R-SOLID-M-08 | W4 · AI | Split ReadMessagesTool | R-AI-04, F-MSG-1 | – | WAITING | |
| R-KRN-09 | W4 · KRN | Builtin context from SDK bridge | F-KRN-1 | KHOST | WAITING | |
| R-KRN-10 | W4 · KRN | Single manifest schema + reject unused slots `CONTRACT` | W1 | – | WAITING | |
| R-KRN-11 | W4 · KRN | SDK contract cleanup + docs `CONTRACT` | F-KRN-1 | – | WAITING | |
| R-SOLID-M-02 | W4 · KRN | Declarative kernel-module actions | S-03, S-04, F-KRN-4 | – | WAITING | |
| R-SOLID-M-09 | W4 · KRN | SDK channel decomposition | F-KRN-1, R-KRN-11 | – | WAITING | |
| R-SOLID-M-05 | W4 · APP | IRendererNotifier port (last in W4) | C-04, D-03 | IPC, DI, KHOST | WAITING | |
| R-UICHAT-03 | W4 · UC | Stable callbacks / memo / SelfJidContext | F-UC-2 | USEMSG | WAITING | |
| R-SOLID-R-01 | W4 · UC | ChatActionsContext | R-UICHAT-03 | USEMSG | WAITING | |
| R-UICHAT-06 | W4 · UC | Split MessageItem (+ SOLID-R-19 quote scroll) | R-SOLID-R-01, R-SOLID-R-03 | USEMSG | WAITING | |
| R-SOLID-R-02 | W4 · UC | Message-kind descriptor table | R-UICHAT-06, R-SOLID-R-12 | – | WAITING | |
| R-SOLID-R-07 | W4 · UC | useMessages event reducer (optional before R-UICHAT-04) | R-SOLID-R-02 | USEMSG | WAITING | |
| R-UICHAT-04 | W4 · UC | Virtualize MessageView 🔎 | R-SOLID-R-02 | USEMSG | WAITING | |
| R-SOLID-R-06 | W4 · UC | ChatLayout container split | F-UC-2, R-SOLID-R-01, C-04 | USEMSG | WAITING | |
| R-SOLID-R-03 | W4 · UC | Complete SystemStub registry | H-01 | – | MERGED | 98ee4cc |
| R-SOLID-R-12 | W4 · UC | Picker + media-download split | N-07 | – | WAITING | |
| R-UICHAT-07 | W4 · UC | useChats / hierarchy dedupe | N-08 | – | WAITING | |
| R-UICHAT-08 | W4 · UC | Split ChatList | R-UICHAT-07 | – | WAITING | |
| R-SOLID-R-11 | W4 · UA | Dismissable primitives + GiphyClient | R-UICHAT-03, F-UC-3 | – | WAITING | |
| R-SOLID-R-05 | W4 · UC | Composer split | R-SOLID-R-11 | – | WAITING | |
| R-SOLID-R-04 | W4 · UC | Contribution-menu host | R-UICHAT-06, R-UICHAT-08, R-SOLID-R-05, R-KRN-10 | – | WAITING | |
| R-UIAPP-06 | W4 · UA | Modal consolidation | N-07 | – | WAITING | |
| R-SOLID-R-08 | W4 · UA | Context slicing | N-08 | – | WAITING | |
| R-SOLID-R-09 | W4 · UA | AI sidebar container + stream contract | F-UA-2, F-AI-4 | – | WAITING | |
| Z-01 | W5 | Logger adoption: main/services | W4 | – | WAITING | |
| Z-02 | W5 | Logger adoption: main/kernel + workers | W4 | – | WAITING | |
| Z-03 | W5 | Logger adoption: renderer | W4 | – | WAITING | |
| Z-04 | W5 | Logger adoption: sdk | W4 | – | WAITING | |
| Z-05 | W5 | `any` burn-down → lint 0 errors → strict CI | W4 | – | WAITING | |
| Z-06 | W5 | CSS: remove Tailwind, dedupe 🔎 | W4 | – | WAITING | |
| Z-07 | W5 | Dead-code sweep (knip/ts-prune) | W4 | – | WAITING | |
| Z-08 | W5 | Docs, ADRs, CLAUDE.md refresh | Z-01..Z-07 | – | WAITING | |
| R-SOLID-M-15 | W5 | Typed stored-message content | R-MSG-08, R-SOLID-M-07, R-SOLID-M-08 | MSGREPO | WAITING | |
