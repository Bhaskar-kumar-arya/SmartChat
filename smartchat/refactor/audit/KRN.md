# KRN — Plugin microkernel audit

Scope read in full: `src/main/kernel/**` (all 40 files), `src/main/plugins/builtin/**`, `packages/sdk/src/**`,
`src/main/protocol/pluginProtocol.ts`, `src/preload/{panel,overlay}-preload.ts` (webview trust boundary),
kernel wiring in `src/main/index.ts:268-320`. Sample plugins and `docs/architecture/microkernel*.md` skimmed.
Tests in `src/main/tests/kernel/**` and `packages/sdk/tests/**` reviewed.

Trust model (documented in microkernel.md §1.2, "intentionally permissive"): external plugins run as plain
`new Worker(entryPath)` (`PluginLoader.ts:132`) with full Node (`fs`, `child_process`, `fetch`); the
voice-transcriber sample already `require('child_process')`. **So the capability system only holds back plugins
that choose to behave, and code-level enforcement only matters for (a) panel and overlay webviews, which really
are sandboxed, and (b) keeping plugins that behave from being escalated by kernel bugs.** The findings below are
ranked with that in mind.

---

## 1. Bugs (confirmed)

- [B-KRN-01] **crit** `src/main/kernel/api-modules/KernelAIModule.ts:120-130` — `callTool` runs *any* registered tool,
  including the permission-gated builtins, and never applies the consent gate.
  A plugin that declares only `ai:tools:call` (both `codetantra-otp-relay` and `test-all-features` declare it) calls
  `ctx.ai.callTool('executeScript', {script})`, `('queryDatabase', {sql})` or `('sendMessage', …)`. The tools have
  `requiresPermission = true` (`tools/ExecuteScriptTool.ts:112`, `QueryDatabaseTool.ts:171`, `SendMessageTool.ts:24`).
  The IPC path (`ipcHandlers.ts:434-445`, main-process consent dialog) and the HTTP path (`ToolsController.ts:53`)
  both refuse or prompt for these tools. Here `tool.execute(args)` runs silently and skips every `messages:*`/`chats:*`
  scope. This matters for panel webviews, which *are* sandboxed: `kernel:panel:api` routes to the same router
  (`panelIpc.ts:111`), so plugin HTML becomes script execution plus arbitrary SQL.
  This is prior **S7-06, still "open"** in bug-audit/TRACKER.md:1078. Raise it from low to crit, because it also
  bypasses the S10-05/S10-07 consent gate. Fix: refuse `tool.requiresPermission !== false` in `callTool`, or keep
  an explicit allow-list of tools that plugins may call.

- [B-KRN-02] **high** `src/main/kernel/ipc/contributionIpc.ts:138-161` + `PluginHost.ts:196-201` +
  `plugins/builtin/ai-assistant/index.ts:65-76` — `kernel:contribution:execute` can drive the builtin AI-assistant's
  `executeScript`/`queryDatabase` handlers with no consent.
  Scenario: `window.api.executeContribution({slot:'ai-tool', pluginId:'com.smartchat.builtin.ai-assistant',
  id:'executeScript', args:{script:'…'}})`. The preload forwards `opts` verbatim (`preload/index.ts:373`), and
  `executeHandler` forwards `args` without checking its type. The builtin handler picks `payload.args`, and the
  AI-assistant calls `tool.execute(args)` directly. This skips `isTrustedSender` and the main-process dialog added
  in S10-07 for exactly the "XSS'd trusted renderer" threat model. Fix: have the AI-assistant's contributed tools
  delegate through the same consent path, or reject `slot==='ai-tool'` from `kernel:contribution:execute` (the AI
  tool executor uses `sendRequestToPlugin`, not this IPC).

- [B-KRN-03] **high** `src/main/protocol/pluginProtocol.ts:45-57` — the plugin id comes from the URL hostname and is
  never validated, so `plugin://../<file>` escapes to `userData`.
  `new URL('plugin://../dev.db').hostname === '..'` (verified in Node for both non-special and standard schemes;
  `plugin` is registered `standard:true` at `index.ts:8`). `rootDir = resolve(extensions,'..')` = userData, and the
  prefix check passes because it is relative to that already-escaped root. Any panel or overlay page can
  `fetch('plugin://../dev.db')`: the CSP allows `connect-src plugin:` and the response sets `ACAO:*`. That page can
  then read the SQLite DB (Baileys auth creds live there via `useLocalPrismaAuthState`) and
  `plugin-permissions.json`. `plugin://<otherId>/…` also reads other plugins' files. Fix: require `pluginId` to match
  `PLUGIN_ID_RE`, and ideally only allow the requesting partition's plugin (`persist:plugin-<id>`). The existing
  test (`pluginProtocol.test.ts:59`) covers path traversal only, not the host. *Verify once in a live Electron build
  that Chromium keeps `..` as the host; the Node WHATWG parser does.*

- [B-KRN-04] **high** `src/main/kernel/KernelBootstrapper.ts:199-203` — a single bad installed plugin makes
  `boot()` reject, which takes down the whole plugin system.
  `for (…installed) { await host.load(manifest.id) }` has no per-plugin catch. Since S8-02, `load()` *throws* on
  activation failure or timeout (`PluginHost.ts:480-505`). `loader.load` also throws on a missing entry, or when the
  directory name ≠ `manifest.id` (`listInstalled` reads `entry.name`, `load` resolves `manifest.id`). `index.ts:278-291`
  then only logs "Failed to boot microkernel", with these results:
  - `registerContributionIpcHandlers` never runs: no `extension:*` IPC, so the user can't even uninstall the culprit.
  - `kernelEventsModule` is never set.
  - `bootResultForShutdown` is unset, so the builtins and the workers already loaded leak with no dispose.

  Fix: try/catch each plugin, log it, and surface it in `extension:list`.

- [B-KRN-05] **med** `packages/sdk/src/channel.ts:362,365,383,394,403` combined with `WorkerPluginChannel.ts:75-79` —
  when the kernel refuses a fire-and-forget SDK call, the plugin worker dies and the kernel never notices.
  `toast`, `events.on` (subscribe and unsubscribe), and the overlay handle's `send`/`close` are `void self.request(...)`
  with no `.catch`. With `ui:toast` toggled off in Settings, or `events.on('x')` without `events:x`, the result is
  `PERMISSION_DENIED`, then an unhandled rejection, which in a worker becomes an uncaught exception, so the worker exits.
  No `worker.on('error'|'exit')` exists anywhere in the kernel. The main process only logs it via the
  `uncaughtException` handler (`index.ts:61`). The plugin stays "loaded": its contributions stay visible, and every
  kernel→plugin request (ai-tool, badge, deactivate) hangs for 30 s (`PLUGIN_REQUEST_TIMEOUT_MS`).
  codetantra calls `ctx.ui.toast` 13 times. Fix: add `.catch(log)` in the SDK, and have `WorkerPluginChannel` listen
  for `error`/`exit` → reject pending → notify the host so it can mark the plugin crashed and unregister its
  contributions.

- [B-KRN-06] **med** `src/main/kernel/ipc/panelIpc.ts:147-151` — panel event delivery ignores the plugin's
  resource scope and does not sanitize the payload.
  `KernelEventsModule` filters each event by `isResourceAllowed` (P2-S7-01/S7-02). The panel path forwards the raw
  bus payload to the webview. Example: a plugin whose `events:*` scope is `allow:[chatA]` subscribes from its panel
  (`__smartchat.api.events.on('message:incoming')`) and receives every chat. P2-S7-01's fix is therefore incomplete.
  Fix: reuse the same filter and `sanitizeForPlugin` from the events module. Extract both into a shared helper.

- [B-KRN-07] **med** `src/main/kernel/api-modules/KernelMessagesModule.ts:383-403` — `delete` and `react` check scope
  on the caller-supplied `jid`, but the action targets the message's real chat.
  `MessageActionService.deleteMessage/reactToMessage` build `msgKey.remoteJid = dbMsg.chatJid`, and `deleteMessage`
  then runs `updateMessageDeleted(messageId)` and emits `message:deleted` for that chat (MessageActionService.ts:44-69).
  A plugin scoped to chat A can pass `{jid:A, messageId:<msg in B>}`. This marks B's message deleted locally and
  sends a revoke/react whose key names B. The S7-01 fix (`requireMessageScope`) was applied to edit, forward,
  downloadMedia and getReceipts, but not to these two. Fix: `await this.requireMessageScope(pluginId, cap, messageId, jid)`.

- [B-KRN-08] **med** `src/main/kernel/KernelBootstrapper.ts:181-192` + `ui/OverlayHost.ts:147-150` — overlays and modals
  are not torn down when their plugin unloads.
  The unload hook cleans up events, AI tools, panel IPC and panel descriptors, but not `overlayHost`. A handle-mode
  overlay stays on screen (its `overlay:event` relay goes to `getPluginChannel` → undefined). The `pendingOverlays`
  entry survives, so after `extension:reload` the plugin gets `OVERLAY_ALREADY_OPEN` for up to 5 min
  (`OVERLAY_PENDING_TIMEOUT_MS`). Promise-mode overlays for a destroyed DirectPluginChannel leak until the timeout.
  Fix: add `OverlayHost.closeAllForPlugin(pluginId)` (send `overlay:close` to the renderer and evict the entries) and
  call it from the hook. Modals need a `pluginId` on `ModalRequest` for the same treatment.

- [B-KRN-09] **med** `src/main/kernel/ipc/contributionIpc.ts:174-182` + `PluginHost.ts:437` — installing a new version
  of an already-loaded plugin reports success but keeps running the old code.
  `loader.install` `rmSync`s and re-extracts the running plugin's directory, and `registerPluginManifest` swaps in the
  *new* permission set. `host.load(id)` then returns early because the registry already has the plugin. The result:
  the old worker runs under the new manifest's capabilities, panels (served from disk) run the new HTML, and the
  contributions are stale. Fix: in the install handler, `await host.unload(id)` before install (or call `reload` after).

- [B-KRN-10] **med** `src/main/kernel/api-modules/KernelEventsModule.ts:86-118` + `panelIpc.ts:147` — turning a
  capability off in Settings does not stop live event subscriptions.
  The capability is checked only at subscribe time. At delivery time only `isResourceAllowed` runs, and it ignores
  `granted`. After the user unticks `events:*`, the plugin keeps receiving every message until it is reloaded. Fix:
  re-check `hasCapability(pluginId, sub.authKey)` in the delivery closure (it is cheap, a Map lookup).

- [B-KRN-11] **low** `src/main/kernel/permissions/PermissionStore.ts:142-159` — resource scope compares raw JID strings,
  so a deny-list can be bypassed with a LID alias.
  `deny:['123@s.whatsapp.net']` does not match `'<lid>@lid'` for the same person. `messages:send` to the LID form
  passes `requireResourceScope`, and `resolveLidFromJid` routes it to the same chat. Allow-lists fail the other way
  (closed) when events carry the LID form. Fix: normalise both sides through `contactService` (PN↔LID) before
  comparing, or store both forms when a scope is set.

- [B-KRN-12] **low** `src/main/kernel/api-modules/KernelAIModule.ts:167` — the `registerTool` executor doesn't catch a
  rejecting `sendRequestToPlugin`.
  `WorkerPluginChannel` rejects on timeout or destroy, so the AI tool executor throws instead of returning
  `{text:'Error…'}`. The P2-S9-04 fix went into `contributionIpc.ts:109-123` only. Fix: wrap it in try/catch the same way.

- [B-KRN-13] **low** `packages/sdk/src/channel.ts:147-155` — in worker plugins, one throwing event handler stops the
  handlers after it.
  `for (const h of handlers) await h(payload)` has no per-handler try/catch. P2-S8-05 fixed this for builtins only
  (`PluginHost.ts:175-183`). Fix: mirror the builtin try/catch.

- [B-KRN-14] **low** `src/main/kernel/plugins/PluginHost.ts:436-452` — concurrent `load(id)` calls race.
  The `registry.get(id)` check happens before `await loader.load(id)`. Two overlapping installs of the same id (for
  example a double-clicked install) spawn two Workers; the second `registry.register` overwrites the first, and the
  first channel and worker are never destroyed. Fix: keep an in-flight `Map<id, Promise>`.

- [B-KRN-15] **low** `PluginHost.ts:482-487,544` — the activation-timeout and deactivate-grace `setTimeout`s are never
  cleared.
  Each load keeps a 10 s timer (and each unload a 2 s timer) alive even when the ack arrives in 5 ms, which delays
  quit and test teardown. Fix: clear them in a `finally`, or reuse the channel's own timeout.

- [B-KRN-16] **low** `src/main/kernel/ipc/contributionIpc.ts:194-200` — uninstall leaves plugin state behind.
  Uninstall leaves the plugin's `extensionKV` rows and its `PermissionStore` grants/scopes. A different `.scext` later
  installed under the same id inherits both the stored data (tokens, for example) and the user's grants.

SUSPECT (unconfirmed):
- `KernelEventsModule.ts:173` — `unsubscribe` while `resolveBus()` is null leaves the entry in `pluginSubscriptions`,
  and `onBusConnected` re-attaches it, so the plugin gets events it unsubscribed from. This only happens if `getBus()`
  can return null after the first connect. Not verified.
- `panelIpc.ts:149` — the raw bus payload goes to `webContents.send`. If any event carries a non-cloneable value, the
  throw happens inside the bus listener and could affect sibling listeners, depending on `WAEventBus` emit semantics.
- `panel-preload.ts:57` — `__smartchat._init(id)` is exposed to the page's main world, so panel JS can rebind itself
  to any `panelId` it learns and act as that plugin. The main process trusts the `panelId` in the payload (prior
  S9-07, still open). The ids are UUIDs, so this is exploitable only if one leaks.

## 2. Code quality / design issues (ranked)

1. **Capabilities are advisory for workers** (microkernel.md §1.2). Anyone reading the manifest or the Settings UI
   will assume permissions confine the plugin. Either state this in the Settings UI and at install time (the real
   gate is install, and `extension:install` at `contributionIpc.ts:174` has no consent prompt or `isTrustedSender`),
   or plan a move to `child_process` or `vm.Module` with a Node permission model.
2. **The builtin plugin context duplicates the SDK bridge**: `PluginHost.ts:215-421` (≈200 lines) re-implements
   `packages/sdk/src/bridge.ts:createKernelApiBridge`, and has already drifted:
   - defaults differ (`getList` limit 50 vs 20);
   - `showOverlay` handle `on()` is a no-op stub (`PluginHost.ts:304`), so builtins can never receive overlay events;
   - there is no `.catch` on toast.

   `PluginHost.ts` is 605 lines and mixes lifecycle, builtin context construction, handler dispatch and the
   manifest→slot mapping (SRP).
3. **Two manifest validators and two sets of manifest types.**
   - Validators: the kernel's hand-rolled `PluginManifest.ts:66-111` checks only the top level (contribution item
     shapes, `permissions` element types and `panel` paths are unchecked), while the SDK's zod schema
     (`packages/sdk/src/manifest.ts:112-239`) is deep. The loader uses the weaker one.
   - Types: `ContributionsDeclaration` and `PluginManifest` are defined in both
     `kernel/plugins/PluginManifest.ts` and `sdk/src/manifest.ts`.
4. **SDK ↔ kernel contract drift** (CONTRACT surface):
   - `importAPI` → `kernel:plugins:importAPI` (`channel.ts:479`): no `kernel:plugins` module is registered, so it
     always returns NOT_FOUND. The doc §3.1 still lists `kernel:plugins` and `kernel:contributions`.
   - `contribution:compute:chat-badge`, `completion-provider` and `message-send-pipeline` have SDK handlers but
     nothing sends them. The renderer ignores `useContributions('chat-badge')` (`ChatList.tsx:262`), and
     `message-send-pipeline` expects a `next` function that cannot cross `postMessage`.
   - SDK `PluginEventMap` (`sdk/src/events.ts:85-98`) advertises `chat:created`, `chat:archived`, `chat:pinned`,
     `group:participant-*`, `group:subject-changed` and `connection:open|close`. None of these exist in `WAEventMap`,
     so subscribers silently get nothing.
   - The kernel has `kernel:ai:registerTool`, but the SDK has no `ai.registerTool`, so the codetantra sample's
     `if (ctx.ai.registerTool)` block (`plugins/codetantra-otp-relay-plugin/index.js:650`) is dead.
   - Slash commands: the renderer sends the text in `context.text` (`MessageInput.tsx:239`), but the SDK handler reads
     `args`, which `executeHandler` defaults to `''`.
   - Docs say "built-ins are always granted all permissions" (§1.6), but the code checks their manifest. The doc's
     capability table lacks `ui:modal`, `ai:sessions` and `messages:write`, and the samples declare a `scheduler`
     permission that nothing checks.
5. **Duplicated scope and sanitising logic**: event filtering lives in `KernelEventsModule` only; the panel path
   duplicates the subscribe gate (`panelIpc.ts:67-74`) but not the filter (see B-KRN-06).
   `PLUGIN_REQUEST_TIMEOUT_MS` and the `Pending*` types are duplicated in `DirectPluginChannel.ts:4` and
   `WorkerPluginChannel.ts:9`.
6. **Leaky layering**: `IPluginHost.getPlugin()` exposes `channel`, and `contributionIpc` / `KernelAIModule` post raw
   `contribution:execute:*` messages themselves (`contributionIpc.ts:151,110`; `KernelAIModule.ts:167`). There should
   be a single `host.invokeContribution(pluginId, slot, payload)` with timeout and crash handling.
7. **Weak channel naming**: `DirectPluginChannel.sendResponseToPlugin` is also used for plugin→kernel responses and
   shares one `pendingRequests` map for both directions (`DirectPluginChannel.ts:16,35-44`), which makes it hard to
   reason about.
8. **Magic strings**: request types (`'kernel:ui:overlay:send'` and others) are spelled out independently in the SDK,
   `PluginHost` and the modules. There is no shared `KernelRequestType` const.
9. **Casts and validation**: `any`/`as any` appear 16× in the kernel and 23× in `sdk/src/channel.ts`, plus 82 `as X`
   casts in the kernel, mostly unvalidated `payload as {…}` at every module entry (prior S7-09 pattern).
   `KernelStorageModule` accepts any `key`/`value` with no size quota.
10. **Privacy in logs**: `contributionIpc.ts:142` logs the full `opts`, including message context and text, on every
    execution. `sdk/channel.ts:292` logs every incoming kernel request payload, including event payloads with
    message bodies.

## 3. Test quality

Untested sources:
- `KernelBootstrapper` failure path (`bootstrap.test.ts` has 2 happy-path tests);
- `PrismaPluginStorageRepository.ts`;
- `PermissionStore` interaction with LID/PN;
- `IBuiltinPlugin`/`PluginRegistry` (trivial);
- `sdk/src/bridge.ts` and `cli/package.ts`;
- `panel-preload`/`overlay-preload`.

Missing negative and regression cases, one per bug above:
- `callTool` on a `requiresPermission` tool (`KernelAIModule.test.ts:84-110` only tests scope on the name);
- `delete`/`react` with a cross-chat `messageId` (`KernelMessagesModule.test.ts:90-110` test only the capability);
- the `plugin://..` host (`pluginProtocol.test.ts:59` covers path traversal only);
- boot with one throwing plugin;
- worker crash or exit;
- panel event scope filtering (`panelIpc.test.ts` tests the gate only);
- overlay cleanup on unload;
- install over a loaded plugin;
- SDK handler throwing in `kernel:events:emit`;
- SDK fire-and-forget request rejected.

Weak or misleading tests:
- `e2e/external-plugin.test.ts:69-98` never calls `host.load`. It hand-registers a `DirectPluginChannel` in the
  registry and hand-registers contributions, then asserts on what it registered. It is titled "E2E Lifecycle" but only
  tests `unload` and the registry.
- `PluginHost.test.ts:144` ("load() uses IPluginLoader mock…") is over-mocked. The real-worker e2e
  (`test-all-features-plugin.test.ts`) is the good counter-example and should be the model.
- `test-all-features-plugin.test.ts` grants every capability up front (lines 55-71), so it never exercises a denial
  path through a real worker. This is exactly the path that crashes workers (B-KRN-05).
- Several e2e tests use `vi.fn` service stubs whose names don't match real interfaces (`unpinChat`, `unarchiveChat`,
  `unmuteChat` at `test-all-features-plugin.test.ts:98-104`, while the real service uses `pinChat(sock, jid, false)`).
  The stubs aren't type-checked (`any`), so they drift silently.
- Real-timer sleeps appear in 4 files: `WorkerPluginChannel.test.ts` and the e2e tests `test-all-features`,
  `declarative-modal-overlay` and `voice-transcriber-overlay`. Only 5 `useFakeTimers` exist in the whole kernel test
  tree, which makes the tests slow and at risk of flaking.

Duplicated helpers: every e2e test rebuilds `PermissionStore + ContributionRegistry + KernelAPIRouter + PluginHost`
and an in-memory storage repo by hand (for example `test-all-features-plugin.test.ts:55-120`, the declarative-modal
e2e tests, `voice-transcriber-overlay.test.ts`). Extract `tests/kernel/helpers/createTestKernel.ts` (in-memory
storage, fake bus, fake window, `grantAll`).

## 4. Refactor proposal

Hotspots (limit parallelism): `PluginHost.ts`, `KernelBootstrapper.ts`, `contributionIpc.ts`, `sdk/src/channel.ts`.

- [R-KRN-01] Shared test kernel harness — goal: add `tests/kernel/helpers/createTestKernel.ts` (real router, modules,
  PermissionStore, in-memory storage, fake bus and window) and a real-worker fixture helper, then migrate 2 e2e tests
  to it. Owns the new helper file and `e2e/external-plugin.test.ts` (rewrite it to go through `host.load`). Depends
  on none. Risk: low. Verify: `npx vitest run --project main src/main/tests/kernel`.
- [R-KRN-02] Lock down `callTool` and the contributed builtin tools (B-KRN-01/02) — owns `KernelAIModule.ts`,
  `contributionIpc.ts:138-161`, `plugins/builtin/ai-assistant/index.ts`. Depends on none. Risk: med, because
  plugin-visible behaviour changes: permission-gated tools become uncallable. Safety net: first add tests for the
  current callTool/execute paths. Verify: new denial tests, and the AI chat still runs tools through `AIToolService`.
- [R-KRN-03] Validate the plugin protocol host (B-KRN-03) — owns `protocol/pluginProtocol.ts` and its test. Depends on
  none. Risk: low. Verify: `..`, `.` and other-plugin hosts all return 403. Manually load a panel in the app.
- [R-KRN-04] Worker crash handling plus SDK rejection hygiene (B-KRN-05/13) — owns `WorkerPluginChannel.ts`,
  `IPluginChannel.ts` (add `onClosed`), `PluginHost.ts` (mark crashed and unregister contributions), `sdk/src/channel.ts`.
  Depends on R-KRN-01. Risk: med. Safety net: a real-worker test that throws asynchronously. Verify: the plugin
  disappears from `listLoaded`, and pending requests reject immediately.
- [R-KRN-05] Resilient boot and install (B-KRN-04/09/14/16) — owns `KernelBootstrapper.ts`, `contributionIpc.ts`
  (install/uninstall handlers), `PluginHost.load` (in-flight map). Depends on R-KRN-01. Risk: med. Safety net: a boot
  test with one broken plugin, and a double-install test. Verify: the app boots with a corrupt plugin dir and
  `extension:list` shows it as failed.
- [R-KRN-06] Unified event delivery policy (B-KRN-06/10) — extract `kernel/events/EventDeliveryPolicy.ts` (capability
  re-check, scope filter, sanitize) and use it from `KernelEventsModule.ts` and `panelIpc.ts`. Depends on none.
  Risk: med. Safety net: the existing `KernelEventsModule.test.ts` plus `panelIpc.test.ts`, extended with scoped
  cases. Verify: a scoped panel receives only allowed chats, and revoking stops delivery.
- [R-KRN-07] Message scope completion and JID normalisation (B-KRN-07/11) — owns `KernelMessagesModule.ts` and
  `PermissionStore.isResourceAllowed` (inject a normaliser). Depends on none. Risk: med, because LID resolution is
  async and the check would need to become async. Safety net: cross-chat delete/react tests and LID-alias deny tests.
- [R-KRN-08] Overlay lifecycle per plugin (B-KRN-08) — owns `OverlayHost.ts`, `IOverlayHost.ts`,
  `KernelUIModule.ts` (pass `pluginId` into `showModal`), and the `KernelBootstrapper` hook line. Depends on
  R-KRN-05 (same file, so run them sequentially). Risk: low. Verify: unload closes the overlay and reload can reopen it.
- [R-KRN-09] Builtin context built from the SDK bridge — replace `PluginHost.ts:215-349` with
  `createKernelApiBridge(request)` plus the builtin-only pieces, and move the builtin context into
  `kernel/plugins/BuiltinContextFactory.ts`. Depends on R-KRN-04 (same file). Risk: med, because builtin defaults
  change (getList limit). Safety net: the `PluginHost.builtin.integration` tests and the builtin tests.
- [R-KRN-10] Single manifest schema — the kernel's `validateManifest` delegates to the SDK zod schema, and the kernel
  types re-export from the SDK. Also validate the `panel` path the same way as `main`. Owns `PluginManifest.ts` and
  `sdk/src/manifest.ts`. Depends on none. Risk: med. **CONTRACT-CHANGE**: stricter manifests may reject currently
  installed plugins, so run all 4 sample manifests and add tests for them.
- [R-KRN-11] SDK contract cleanup — remove or implement `importAPI`, badge, completion and pipeline; align
  `PluginEventMap` with `WAEventMap`; add `ai.registerTool`; fix slash-command `args`. Owns `sdk/src/{channel,events,context}.ts`
  and the samples. Depends on R-KRN-04. Risk: med. **CONTRACT-CHANGE (plugin SDK API)**. Update
  `docs/architecture/microkernel.md` §3.1 and §1.6 in the same unit.

## 5. Top 5
1. `kernel:ai:callTool` lets any plugin with `ai:tools:call` run `executeScript`, `queryDatabase` and `sendMessage`
   with no consent prompt and no chat scope. This is prior S7-06, still open, and should be crit (KernelAIModule.ts:120-130).
2. `plugin://` protocol takes the plugin id from the URL host unchecked, so `plugin://../dev.db` lets any plugin
   panel read the userData DB (WhatsApp creds) and permissions file (pluginProtocol.ts:45-57).
3. One broken or slow installed plugin makes `KernelBootstrapper.boot()` reject, which drops all extension IPC
   including uninstall. Boot needs a per-plugin try/catch (KernelBootstrapper.ts:199-203).
4. Worker plugins have no crash detection, and the SDK's unguarded `void request()` calls (toast, events.on,
   overlay send) turn a normal PERMISSION_DENIED into a dead worker that still shows as loaded, with 30 s hangs
   (sdk/channel.ts:383,403; WorkerPluginChannel.ts:75).
5. Scope enforcement has gaps: panel events skip the per-chat filter (panelIpc.ts:147), `delete`/`react` check the
   wrong JID (KernelMessagesModule.ts:383-403), revoking a permission doesn't stop live subscriptions, and worker
   plugins have full Node access anyway, so the capability system is advisory.
