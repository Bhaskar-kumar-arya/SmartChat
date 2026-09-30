# Audit: AI slice (AI service, providers, tools, search, train)

Scope read in full: `src/main/services/ai/**` (AIService, providers/*, prompts/*, citations/*, mentions/*,
AIChatSessionService, AIChatExportService, AIKeyService, FSKeyStorage, AIToolService, AIToolInitializer),
`src/main/tools/*`, `src/main/services/search/*`. Cross-checked call sites: `ipcHandlers.ts` (ai-chat,
ai-chat-stream, abort-ai-chat, execute-tool, index-embeddings), `auth.ts` (vec table, adapter),
`workers/embedding/embedding.worker.ts`, `MessageQueryRepository.assertReadOnlySql`, `MessageVectorRepository`,
renderer `useAIStream.ts` (tool loop). `train/**` skimmed. Prior trackers checked; fixed items re-reported only
where the fix is wrong/incomplete.

Two findings were reproduced at runtime in the scratchpad against the real compiled code + node_modules
(B-AI-01 sandbox boundary, B-AI-03 vec0 dimension), not merely read.

---

## 1. Bugs (confirmed)

- [B-AI-01] **crit** `src/main/tools/ExecuteScriptTool.ts:171-194` — S12-03 fix is incomplete: the vm sandbox is still escapable to the host realm.
  The bootstrap pins `globalThis.constructor` to the context's `Object`, but the contextified sandbox object (`vm.createContext({})`)
  still inherits from the **host** `Object.prototype`. Reaching the prototype of the sandbox global (via `__proto__` /
  `Object.getPrototypeOf(globalThis)`) yields a host-realm object whose `constructor.constructor` is the host `Function`,
  from which `process` / `require` and full Node capability (fs, child_process, the plaintext key files) are reachable.
  Confirmed by compiling the real tool and running a script that walked the sandbox global's prototype to the host `process`
  and executed a shell command — it succeeded (`success:true`). The regression test only covers `this.constructor`,
  `[].constructor`, `echo.constructor` — it does not cover the prototype-of-global path, so it passes while the hole is open.
  Because the tool is prompt-injection reachable (a script the model writes from message content the user waves through),
  this is arbitrary code execution in the main process.
  Fix: do not treat `vm` as an isolation boundary. Run scripts in a `worker_threads` Worker / child process with no `require`
  and an explicit message-port RPC for tool calls. Interim hardening: `vm.createContext(Object.create(null))` and extend the
  test to the prototype-of-global escape so the boundary is actually asserted.

- [B-AI-02] **high** `src/main/tools/ExecuteScriptTool.ts:214, 352-372` — a synchronous CPU loop in a script hangs the whole Electron main process; the 60 s timeout cannot fire.
  `compiled.runInContext(context)` is called with **no `timeout` option**, and `runScriptWithTimeout` is a
  `Promise.race` against a `setTimeout` — a timer that only fires when the event loop gets a turn. A script body that
  never yields (e.g. an unbounded `while` loop, easy for a local model to emit) blocks the main thread forever: UI freezes,
  IPC stops, `abortResponse` cannot run. Reproduced: a synthetic script parked the process past a 5 s external kill.
  The `aborted`/MAX_TOOL_CALLS guards only apply between `await` points, so they never engage on a tight sync loop.
  Fix: pass `{ timeout: MAX_EXECUTION_MS }` to `runInContext`/`vm.Script.runInContext` so V8 interrupts synchronous
  execution, in addition to the async race (which only covers async hangs). A real worker (see B-AI-01) also solves this
  via `worker.terminate()`.

- [B-AI-03] **high** `src/main/services/search/EmbeddingService.ts:319` vs `auth.ts:131-160`, `VectorSyncService.ts:15` — embedding model produces 384-dim vectors but the vec0 table is declared `FLOAT[768]`, so every insert throws and deep search is fully broken.
  The restored worker (P2-S11-01) loads `Xenova/all-MiniLM-L6-v2` (384 dims). `vec_messages` is created as `vector FLOAT[768]`
  (comment says "correct 768 dimensions for Bhasha model"). Confirmed with better-sqlite3 + the bundled sqlite-vec:
  inserting a 384-element vector into a `FLOAT[768]` vec0 table throws `Dimension mismatch … Expected 768 … received 384`,
  and a 384-dim `MATCH` query throws likewise. Effects: `EmbeddingService.indexMessage`/`indexAll` log
  "Failed to index message" for every row (the `insertIntoVecMessages` call at 413/474 always throws — the `upsertVector`
  to the Prisma `MessageVector` table succeeds, so `getAllIndexedMessageIds` marks rows "indexed" and `indexAll` then
  permanently skips them); `SearchService.deepSearch` gets 0 hits (the vec query throws, caught → `[]`); `VectorSyncService.sync`
  deletes every stored vector as a "dimension mismatch" (expects 768, gets 384). Semantic search silently returns nothing.
  Prior audit "fixed" the worker (real model) and the table (768) independently and they disagree.
  Fix: make the dimension a single shared constant that the vec0 DDL, the `!== 768` guard, and the model choice all derive
  from; use 384 for MiniLM (or load a genuinely 768-dim model). Then `clearAllVectors` + reindex.

- [B-AI-04] **med** `src/main/services/ai/providers/GeminiProvider.ts:33-43` — Gemini history role mapping collapses `[SYSTEM]` turns into `model`, mislabeling tool results as the assistant's own words.
  `formatHistory` maps `msg.role === 'user' ? 'user' : 'model'`. App history carries `role: 'ai'` for assistant turns and
  also injects tool-result turns as `role:'user', isSystem:true` (renderer `useAIStream.ts:243`/`273`, and
  `AIService.generateResponseWithTools` pushes `{role:'user'}` for the `[SYSTEM] Tool Result` prompt). A history-persisted
  system/tool turn whose role is not exactly `'user'` (e.g. any `'ai'`/`'system'` label) becomes a Gemini `model` turn.
  Contrast: the Groq/Mistral/DeepSeek providers were hardened for the `'ai'` role (S6-02) but Gemini — the default provider —
  was not audited for the symmetric case. The `wrapWithRole` `[SYSTEM]/[AI]` prefix partly compensates, but the structured
  Gemini `role` is still wrong, which the model weights more than the text prefix.
  Fix: map `'ai'`/`'model'`/`'assistant'` → `model`, everything else → `user`, and route `isSystem` turns to `user` (as the
  system-prompt contract in `MESSAGE_ROLES_SECTION` states `[SYSTEM]` is tool output, i.e. a user-side turn).

- [B-AI-05] **med** `src/main/services/ai/AIChatSessionService.ts:80-84` (`deleteSession`) + `prisma/schema.prisma:341-347` (Citation) — deleting an AI chat session orphans its Citation rows forever.
  `AIChatMessage` has `onDelete: Cascade` to `AIChatSession`, but `Citation` (`@@id([sessionId, index])`) has **no FK/relation**
  to `AIChatSession` at all — it is a bare table keyed by `sessionId`. `deleteSession` deletes the session (cascading messages)
  but never deletes citations. Rows accumulate unbounded across every deleted session. Worse, `CitationSessionManager.createEmitter`
  seeds the next index from `MAX(index) WHERE sessionId` — if a session id is ever reused (clone uses a new id, so low risk today)
  stale rows would shift indices. Primarily an unbounded-growth leak.
  Fix: add a relation + `onDelete: Cascade` from Citation to AIChatSession, or delete citations in `deleteSession`
  (`prisma.citation.deleteMany({ where: { sessionId } })`).

- [B-AI-06] **med** `src/main/services/ai/AIService.ts:319-325` (`generateResponse` catch) + `ipcHandlers.ts:517-548` — a caller-supplied `options.signal` (not `requestId`) is honored by providers but the abort surfaces as an error toast, and non-stream `generateResponse` never clears `abortedRequests`.
  Providers read `options?.signal instanceof AbortSignal` (Groq/Mistral/DeepSeek/Gemini) in addition to the `requestId`-derived
  signal. Nothing in the main process sets `options.signal`, so this is dead-but-live surface: a plugin (`KernelAIModule.chat`)
  passing `signal` through `options` would get provider aborts, but `generateResponse`'s catch rethrows AbortError as a normal
  error (only `ai-chat-stream` at ipcHandlers:542 special-cases AbortError → `-end`; the `ai-chat` invoke path does not).
  Also, per S6-03's own note, `generateResponse`'s `requestId` is deliberately left in `abortedRequests`; it is only cleared by
  `generateResponseStream`/`generateResponseWithTools`. The `ai-chat` (non-stream) IPC path therefore leaks each aborted
  `requestId` into `abortedRequests` permanently — S6-03 fixed only the stream path and explicitly declined the invoke path.
  Fix: clear `options.requestId` from `abortedRequests` in `generateResponse`'s `finally` when the call is not nested inside
  `generateResponseWithTools` (pass a flag), and translate AbortError to a clean end on the `ai-chat` path too.

- [B-AI-07] **med** `src/main/services/ai/AIService.ts:174-190` (`buildFullPrompt`) — chat-context substitution uses an unanchored, attacker-influenced RegExp built from the chat name; a `/name` token elsewhere in the prompt is wrongly replaced and one chat's context can be injected in place of another's.
  `safeName` escapes regex metachars but the pattern `/${safeName}` has no leading boundary, so `/GroupA` matches inside
  `/GroupAB` and the wrong (or every occurrence of a) context block is spliced in. Two contexts whose names are
  prefixes of each other resolve to the first. The block itself is escaped (S6-01), so this is a correctness/confusion bug,
  not injection, but it silently attaches the wrong transcript to the model.
  Fix: match `/<name>` with a trailing non-word boundary (as the mention enricher already does at
  `AIMentionEnricher.ts:153`), and match longest-name-first.

### SUSPECT (unconfirmed)

- `src/main/services/ai/providers/LMStudioProvider.ts:175-205` (`getOrLoadModel`) — no in-flight de-dup lock (S6-11, left
  WONTFIX): two near-simultaneous requests for a not-yet-loaded model both `await load()`; the context-length-mismatch branch
  can `unload` a model out from under a running `respond()`. Plausible with a background system generation + a chat message,
  but I could not drive the LM Studio client to confirm.
- `src/main/services/search/EmbeddingWorkerManager.ts:99-142` — `ensureWorker`'s `init` promise resolves on the **first**
  `init_done`, but `handleWorkerMessage` also calls the same `resolve`/`reject` for later global `error` messages (id null)
  captured in the closure; after a successful init a subsequent global worker error would call a stale `reject` (no-op on an
  already-resolved promise, so likely harmless) — worth confirming there is no path where init resolves before the model is
  truly ready.

---

## 2. Code quality / design issues

- **Massive provider duplication (highest-impact).** `GroqProvider.ts` (238), `MistralProvider.ts` (238),
  `DeepSeekProvider.ts` (274) are near-identical: `diff GroqProvider MistralProvider` differs only in the client class,
  base URL, model-id prefix, default model, filter substrings and log strings; DeepSeek adds reasoning-content handling.
  `formatMessages`, `getToolsForX`, `stripPrefix`, the streaming tool-call reassembly loop (the S6-06 fix, lines ~154-202),
  and the native→XML conversion are copy-pasted three times. Any provider bug (S6-06, B-AI-04-style role bugs) must be fixed
  in triplicate. Extract a `BaseOpenAICompatibleProvider` (Mistral/DeepSeek already both use the `openai` SDK; Groq's
  `groq-sdk` is API-compatible) parameterized by `{prefix, baseURL, defaultModel, modelFilter, reasoning}`.

- **`AIService.ts` is a god class (468 lines)** mixing: provider registry, model-id normalization/routing, key
  masking/persistence, prompt assembly (`formatChatHistory`/`buildFullPrompt` — string templating that belongs with
  `SystemPromptBuilder`), history enrichment, abort bookkeeping, and the agentic tool loop. `formatChatHistory`/`buildFullPrompt`
  (139-190) duplicate escaping logic that already lives in `mentions/xmlEscape.ts` and conceptually belong in the prompt layer.

- **`generateResponseWithTools` is dead in production (S6-04, WONTFIX).** The real tool loop is in the renderer
  (`useAIStream.ts`), which re-implements turn handling with **no turn cap** and the same non-global first-`<tool_call>` regex.
  So `MAX_TOOL_TURNS_CAP = 25`, the between-turn abort, and the `[SYSTEM]`-labelled results all exist only in an unused method
  and its tests. This is a genuine latent hazard: the safety net looks wired but is not. Either route the renderer through IPC
  to this method, or move the cap into the renderer loop (frontend slice) — but do not leave a tested-but-unreachable safety loop.

- **`any`/cast density.** `services/ai`: 5 `any` + 28 `as` casts; `tools`: 16 casts; `services/search`: 4 `any` + 6 casts.
  Concentrated at provider option boundaries (`options: { [key: string]: unknown }` then `as` back out) and LMStudio
  (`as unknown as Parameters<typeof model.respond>[1]` twice). `IAIChatSessionService` returns `Promise<any>` for every
  session method (loses the whole session/message shape at the IPC boundary).

- **`ToolExecutionContext` has an unused `sessionId` field** (`IToolRegistry.ts:9`) — never set (the IPC handler builds ctx
  with only `citationEmitter`). Dead field at a contract boundary.

- **Two parallel SQL denylists** — `QueryDatabaseTool` and `ReadMessagesTool` each carry their own copy of
  `FORBIDDEN_KEYWORDS` + `FORBIDDEN_PATTERNS` + `stripLiteralsAndComments` + `validateSqlQuery`, and
  `MessageQueryRepository.assertReadOnlySql` is a **third** copy. The three lists already diverge (the repo list adds `REINDEX`
  and a statement-batching check that the tools lack; the tools add `LOAD_EXTENSION/READFILE/WRITEFILE/FSDIR` the repo lacks).
  A single shared `assertReadOnlySelect(sql)` util should back all three. Note: structural read-only is actually enforced by
  sqlite-vec's authorizer (`load_extension` → "not authorized", confirmed) and better-sqlite3's single-statement rule — the
  denylists are defense-in-depth, which is more reason to unify them.

- **Magic dimension constant `768`** hardcoded in `auth.ts` (×4), `VectorSyncService.ts`, and implied by the model in the
  worker — the root of B-AI-03. Should be one exported constant tied to the model.

- **`Provider.ts` `AIProvider` interface is dead** — no implementer or importer; providers implement the split
  `IStreamingProvider`/`IFullResponseProvider` directly.

- **Committed API key still in `train/Annotate_Data.ts:54`** (`const GEMINI_API_KEY = "AIza…"`). `train/**` is excluded from
  the electron build (`electron-builder.yml:17`) and git-tracked as a dev tool, but this is a live-looking Google API key in
  source and should be revoked/rotated and replaced with an env-only read (the file already falls back to
  `process.env.GEMINI_API_KEY` at :506). Same class as S6-01. Flagging as a hygiene/secret issue, not a shipped-app bug.

---

## 3. Test quality

- **No provider unit tests exist for Gemini or LMStudio.** `GeminiProvider` (the default provider, and the B-AI-04 role bug)
  and `LMStudioProvider` (context-length, tool XML, S6-11 race) have zero tests. Only Groq/Mistral/DeepSeek are touched, and
  only for two narrow behaviors (role mapping, index-less reassembly).

- **`tests/services/ai/AIService.test.ts:62-65` is a non-test** — `getAvailableModels` asserts only `toBeDefined()` on a value
  that is a `Promise.all(...).flat()` and can never be undefined; passes even if every provider throws.

- **The executeScript sandbox test gives false assurance (B-AI-01).** `tests/tools/ExecuteScriptTool.test.ts:47-60` asserts
  three specific constructor-chain escapes are neutralized but omits the prototype-of-global path that actually works, so a
  crit RCE hole ships green. Security tests for a "boundary" must be adversarially complete or not claim the boundary.

- **No test covers the vec0 dimension contract (B-AI-03).** `EmbeddingService.test.ts` mocks the vector repo entirely
  (`upsertVector`/`insertIntoVecMessages` are `vi.fn()`), so the 384-vs-768 mismatch — a total feature outage — is invisible.
  Needs one integration test that inserts a real model-dim vector into the real vec0 DDL.

- **`ExecuteScriptTool` has no test for the sync-loop hang (B-AI-02)** — the timeout test parks the script in an `await`, i.e.
  only the async path; the sync-hang path (the actual main-thread freeze) is untested.

- **Over-mocking / testing the mock.** `AIService.test.ts` mocks all five provider constructors to `vi.fn()` then injects a
  hand-rolled `mockProvider`; the streaming test asserts `chunkHandler` got `'RESPONSE'` — which is just the mock's return,
  exercising the fallback branch, not real streaming.

- **Duplicated test fixtures.** `providerRoleMapping.test.ts` and `streamingToolCallReassembly.test.ts` each redefine
  `const keyService = { getKey … }` / `const toolRegistry = { getAllTools … }` and a `streamOf` async-iterator helper.
  A shared `tests/services/ai/providerTestUtils.ts` (fake key service, fake registry, `streamOf`, fake OpenAI client) should
  back both and any new base-provider tests.

- Strong tests worth keeping as characterization anchors: `AIService.test.ts` S6-01 escaping + turn-cap + between-turn-abort,
  `QueryDatabaseTool.test.ts` (literal-stripping + row-cap), `CitationSessionManager.test.ts` (11 cases incl. collision
  fallback), `streamingToolCallReassembly.test.ts`.

---

## 4. Refactor proposal for this slice

- [R-AI-01] **Fix executeScript isolation (security)** — goal: close B-AI-01/B-AI-02. Files:
  `tools/ExecuteScriptTool.ts`, a new `workers/script/script.worker.ts`, `tests/tools/ExecuteScriptTool.test.ts`. Depends on: none.
  Risk: high (behavior + security critical; worker RPC changes tool-call latency). Safety net first: extend the sandbox test
  with the prototype-of-global escape and a sync-loop-timeout case (both should FAIL against current code), plus the existing
  tool-call/abort/console cases. Verify: escapes resolve undefined/throw; `while(true)` script returns `timedOut:true` within
  the wall clock without freezing the runner; tool calls, MAX_TOOL_CALLS, abort-after-timeout still pass. Interim-only variant
  (lower risk): `runInContext(..., { timeout })` + `Object.create(null)` context, same tests.

- [R-AI-02] **Unify the vector dimension + reindex path** — goal: fix B-AI-03. Files: `auth.ts`, `services/search/VectorSyncService.ts`,
  `services/search/EmbeddingService.ts` (or a new `search/embeddingConfig.ts` constant), `workers/embedding/embedding.worker.ts`.
  Depends on: none. Risk: med (touches DB DDL + a self-heal DROP path; existing 768 rows are already all-failing so data loss
  is nil). CONTRACT-CHANGE (vec0 table schema). Safety net: an integration test inserting a real MiniLM-dim vector into the real
  vec0 DDL and round-tripping a MATCH. Verify: `deepSearch` returns ranked hits; `indexAll` persists into `vec_messages` without
  per-row errors; `VectorSyncService.sync` keeps vectors.

- [R-AI-03] **Extract `BaseOpenAICompatibleProvider`** — goal: collapse Groq/Mistral/DeepSeek duplication and fix B-AI-04 once.
  Files: new `providers/BaseOpenAICompatibleProvider.ts`, `providers/{Groq,Mistral,DeepSeek}Provider.ts`,
  `providers/GeminiProvider.ts` (role map), `tests/services/ai/providerTestUtils.ts`, existing provider tests. Depends on: none.
  Risk: med (all cloud providers at once). Safety net first: broaden `providerRoleMapping` + `streamingToolCallReassembly`
  tests to run through the shared util and add a Gemini role-mapping test (B-AI-04). Verify: role mapping, tool XML emission,
  index-less reassembly, model listing/fallback identical before/after.

- [R-AI-04] **Single shared read-only-SQL guard** — goal: dedupe the three denylists. Files: new
  `services/messages/sql/assertReadOnlySelect.ts`, `tools/QueryDatabaseTool.ts`, `tools/ReadMessagesTool.ts`,
  `services/messages/MessageQueryRepository.ts`, their tests. Depends on: none. Risk: low (pure extraction; keep the union of
  keywords). Verify: the existing QueryDatabaseTool + ReadMessagesTool sqlcap tests plus the repo's read-only tests all pass
  against the shared util.

- [R-AI-05] **Citation lifecycle + session type safety** — goal: fix B-AI-05 and remove `Promise<any>` from
  `IAIChatSessionService`. Files: `prisma/schema.prisma` (Citation relation), `services/ai/AIChatSessionService.ts`,
  `services/ai/IAIChatSessionService.ts`, `tests/services/ai/AIChatSessionService.test.ts`. Depends on: none. Risk: med.
  CONTRACT-CHANGE (schema: add FK + migration; typed session/message shapes cross the IPC boundary). Safety net: a test that
  deletes a session with citations and asserts the Citation rows are gone. Verify: delete cascades; typecheck across preload/renderer.

- [R-AI-06] **Move prompt assembly out of AIService** — goal: shrink the god class; put `formatChatHistory`/`buildFullPrompt`
  next to `SystemPromptBuilder`/prompt content and reuse `xmlEscape`. Files: `services/ai/AIService.ts`, new
  `services/ai/prompts/PromptAssembler.ts`, `tests/services/ai/AIService.test.ts` (S6-01 cases move with it). Depends on: none.
  Risk: low-med (behavior-preserving; the S6-01 escaping tests are the safety net). Verify: existing escaping + context-append
  tests pass unchanged.

**Hotspots limiting parallelism:** `AIService.ts` is touched by R-AI-03/05/06; the three provider files by R-AI-03;
`auth.ts` by R-AI-02 (also touched by other slices' DB work); `ipcHandlers.ts` (shared across the whole app) by any
IPC-contract change (B-AI-06, R-AI-05). Do R-AI-01/02/04 first (independent, no AIService churn), then R-AI-03, then R-AI-06/05.

---

## 5. Top 5

1. [B-AI-01] executeScript's `vm` "sandbox" is still escapable to host RCE via the sandbox global's prototype — the S12-03 fix and its test miss this path; treat `vm` as no boundary and run scripts in a real worker.
2. [B-AI-02] a synchronous loop in an executeScript script freezes the entire Electron main process; `runInContext` has no V8 `timeout`, so the 60 s async race never fires.
3. [B-AI-03] the embedding model emits 384-dim vectors but `vec_messages` is `FLOAT[768]`, so every vector insert throws and semantic/deep search silently returns nothing — two separate "fixes" disagree on the dimension.
4. [B-AI-04] the default Gemini provider mismaps history roles (`[SYSTEM]`/tool turns become `model`), the symmetric bug to the Groq/Mistral/DeepSeek S6-02 fix that Gemini never got.
5. Provider classes are near-identical triplicated code (Groq/Mistral/DeepSeek ~250 lines each) and the only capped/abortable tool loop (`generateResponseWithTools`) is dead in production while the live renderer loop has no turn cap — extract a base provider and rewire or relocate the safety loop.
