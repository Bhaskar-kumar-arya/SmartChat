# APP slice audit — app shell, composition root, IPC, misc services

Scope read in full: `src/main/{index,ServiceContainer,ipcHandlers,auth,constants}.ts`, `src/main/ipc/*`,
`src/main/protocol/pluginProtocol.ts`, `src/main/services/protocol/*`, `src/preload/*`,
`src/main/services/{apiServer(+controllers),notification,calls,audio,auth}/*`, build/lint/CI config,
plus the renderer contract files `src/renderer/src/services/{api.service,IAPIService}.ts`.
Cross-checked prior trackers (`bug-audit*/TRACKER.md`); nothing below re-reports a correctly fixed item.

---

## 1. Bugs (confirmed)

- [B-APP-01] **high** `src/main/index.ts:123-136` — The close interceptor blocks every quit that doesn't go through the tray menu. There is no `before-quit` handler that sets `isQuitting`.
  macOS (the only CI build target, `.github/workflows/build-mac.yml`): Cmd+Q, Dock → Quit or an OS logout/restart calls `app.quit()`. That fires the window `close` event, and with `minimizeToTray` at its default of `true` (`NotificationService.ts:40`) the handler calls `preventDefault()` and hides the window, so the quit is cancelled. Only Tray → Quit (`index.ts:298-300`) works.
  Fix: `app.on('before-quit', () => { isQuitting = true })`. Test: simulate before-quit then close and assert no `preventDefault`.

- [B-APP-02] **med** `src/preload/index.ts:355-369` — The extension-chat IPC surface has no backend. Nothing in `src/main` registers `extension:chat-history`, `extension:chat-send` or `extension:get-docs`, and nothing sends `extension:chat-push` or `extension:focus`. `dedicatedChat` appears nowhere in `src/main` or `packages/sdk/src`.
  Repro: ExtensionManager "open chat" (`ExtensionManager.tsx:127-129`) → `ExtensionChatView` → `useExtensionChat.ts:40-48`. `invoke('extension:chat-history')` rejects with "No handler registered" (logged only), and each `send` (`useExtensionChat.ts:69`) is silently dropped. The UI looks functional but does nothing.
  `createMockApiService` (`src/renderer/tests/mocks/mockApiService.ts:135-138`) resolves these calls, so renderer tests pass. Fix: either implement the handlers in kernel IPC or delete the feature (CONTRACT-CHANGE).

- [B-APP-03] **med** `src/main/kernel/api-modules/KernelUIModule.ts:71` and `src/main/workers/bridge/WAWorkerBridge.ts:196` — Main sends `toast` and `wa-disconnected` on `webContents`, but the preload never subscribes to either (`preload/index.ts` has no `ipcRenderer.on` for them).
  (a) The plugin SDK `ui.toast` capability returns `{success:true}` and nothing is shown.
  (b) The worker-death "UI signal", whose comment says it exists so WhatsApp isn't left "permanently dead … no UI signal", never reaches the renderer. That earlier fix is incomplete.
  Fix: add `onToast`/`onWaDisconnected` to the preload, `index.d.ts` and `IAPIService`, and wire them to `ToastContext` and the connection state in `App.tsx`.

- [B-APP-04] **med** `src/main/ipcHandlers.ts:391-401` — `index-embeddings` catches and swallows every failure and sends no terminal progress event.
  P2-S11-01 made `EmbeddingService.indexAll` throw when the model is unavailable (`EmbeddingService.ts:130-137`). The renderer sets progress to 0 (`ChatList.tsx:158`) and relies on either a rejection (`:161-164`) or `pct===100` (`:118`) to clear it. Neither happens, so the progress bar stays stuck at 0% for the whole session and the "fail loudly" fix never reaches the user.
  `clear-vectors` (`:403-413`) swallows errors the same way. Fix: rethrow, or return `{ok:false,error}`, from both handlers.

- [B-APP-05] **low** `src/main/index.ts:345-347` — On macOS, `activate` (Dock click) only calls `createWindow()` when there are zero windows. With `minimizeToTray` the window is hidden but still counted, so clicking the Dock icon does nothing. Only the tray restores it. Fix: `else mainWindow?.show()`.

- [B-APP-06] **low** `src/main/index.ts:108-169` — `mainWindow` is never nulled on `closed`. On macOS with `minimizeToTray=false`, closing the window destroys it but every `getMainWindow` accessor keeps returning the destroyed object.
  `NotificationService.notify` then calls `mainWindow?.isFocused()` (`NotificationService.ts:85`), which throws "Object has been destroyed" on the message-receive path. `TrayService.restoreWindow` (`TrayService.ts:53-58`) throws on `isMinimized()` the same way.
  Fix: `mainWindow.on('closed', () => { mainWindow = null })`.

- [B-APP-07] **low** `src/main/services/apiServer/APIServer.ts:89-102` — `server.listen` has no `'error'` listener. EADDRINUSE on port 3003 (a second profile, or another local tool) is emitted as an unhandled `'error'` event, becomes an `uncaughtException`, and is only logged by `index.ts:61`.
  The `try/catch` at `index.ts:332-336` can't catch it. `this.server` stays non-null, so `start()` can never retry, and `stop()` rejects with ERR_SERVER_NOT_RUNNING at quit.
  Fix: `server.once('error', …)`, which should null `this.server` and surface the error through `getStatus`.

- [B-APP-08] **low (latent)** `src/main/ipcHandlers.ts:351-366` — `set-sync-full-history` calls a setter that is now a no-op (`AuthSettingsService.ts:27-29`) and then `waConnectionManager.connect()`. That stops the current worker bridge and reconnects (`WhatsAppConnectionManager.ts:104-111`), so any caller tears down the live WhatsApp session for nothing.
  No renderer code calls it today, which makes it a dead but hazardous channel. Fix: delete the handler, the preload method and the types, or drop the `connect()` call.

**SUSPECT (unconfirmed)**
- S1 `index.ts:278-292` + `kernel/ipc/contributionIpc.ts:204-219` — Contribution and extension IPC handlers are registered only after the async `bootstrapper.boot()` resolves, and no snapshot is pushed at registration time. If the renderer mounts first, `ContributionContext.tsx:20` rejects on "No handler registered" and never gets a snapshot until some later registry change. `extension:list` rejects the same way. Timing-dependent; not reproduced.
- S2 `auth.ts:142-145` — The dimension self-heal probe runs a `SELECT` through `$executeRawUnsafe`. With the better-sqlite3 adapter this may throw a "returns data" error, which does not match "Dimension mismatch", so self-heal could be dead code. Check with a 384-dim table fixture.
- S3 `services/protocol/AppProtocolHandler.ts:13-14` — `isDev` is derived from `NODE_ENV`, which is likely unset in the packaged main process, so the dev CORS origin is used in prod. The prod renderer loads from `file://` (`index.ts:167`), so `'app://-'` is never the right origin anyway.
- S4 `electron-builder.yml:24-28` — `asarUnpack` lists sqlite-vec only for win and darwin, and does not list `ffmpeg-static`, while `auth.ts:104` and `AudioTranscoderService.ts:13` rewrite paths to `app.asar.unpacked`. On Linux builds, sqlite-vec (and possibly ffmpeg) may fail to load, depending on electron-builder's smart-unpack.
- S5 `preload/panel-preload.ts:57` + `kernel/ipc/panelIpc.ts:93-98` — A panel's identity is the renderer-supplied `panelId`, and `_init` is callable by guest JS, so any page that learns another panel's UUID can act with that plugin's capabilities. Identity should be bound to `event.sender`. UUIDs make exploitation unlikely.

---

## 2. Code quality / design issues (ranked by impact)

1. **No single typed IPC contract; four hand-maintained copies.** Channel strings live in `ipcHandlers.ts` (66 registrations), `index.ts:256,338`, and `kernel/ipc/{contribution,overlay,panel}Ipc.ts` (16). The preload has 141 `ipcRenderer.*` calls, and types are declared separately in `preload/index.d.ts`, `IAPIService.ts` and `api.service.ts`.
   The preload `api` object is untyped: there is no `satisfies Window['api']`, so `index.d.ts` is never checked against the implementation. B-APP-02 and B-APP-03 are direct results. See the §2a map.
2. **`ServiceContainer` is a Pure-DI composition root that turns into a service locator** (`ServiceContainer.ts`, 444 lines, 47 entries).
   - The whole bag is passed to `registerIpcHandlers` (uses 19 entries), `KernelBootstrapper` (14), `AIToolInitializer` (9) and `WhatsAppConnectionManager` (`index.ts:305-312` passes `services` plus 3 of its members again).
   - It exposes raw repositories (`messageQueryRepository & IRawSqlExecutor`, `aliasRepository`) and a function (`getBus`) as if they were services.
   - It is built as a partial object: `const services = {} as unknown as ServiceContainer` (`:162`) is handed to `HistorySyncManager` (`:332`) before `Object.assign` (`:335`). This is unnecessary, because all 10 `HistorySyncDependencies` (`HistorySyncManager.ts:25-36`) already exist by line 332. It only works because deps are read lazily.
   - Environment coupling: `app.getPath`/`__dirname`/`dbPath` inside the factory (`:216-218,309,321-322`). `APIServer`'s constructor does fs I/O (`APIServer.ts:31`). `NotificationService` computes `app.getPath` at module load (`NotificationService.ts:11`) and writes a file in its constructor (`:27`). `audioTranscoderService` is a module singleton (`AudioTranscoderService.ts:107`).
3. **`index.ts` (401 lines) mixes too many responsibilities**: logging, global error hooks, single-instance lock, window factory, webview hardening, protocol setup, kernel boot with bus buffering, tray, IPC, API server, and shutdown. Mutable module state (`services`, `waConnectionManager`, `kernelEventsModule`, `bufferedWaBus`, …) is shared by closures. The indentation break at `:85-86` hides that everything sits inside the `else` of the lock check. `ipcMain.on('ping')` (`:256`) is leftover scaffolding.
4. **`ipcHandlers.ts` (645 lines) is a god-registrar.** It also performs side-effecting initialisation (`AIToolInitializer.initializeAll`, `embeddingService.setOnActiveStateSync` at `:420-426`). There is no runtime validation of any IPC argument (types are compile-time only). The `isTrustedSender` gating is ad hoc: 9 handlers check it and the rest don't, with no stated policy (e.g. `send-media-message` takes an arbitrary `filePath`, `set-ai-options` merges `Record<string,unknown>`).
   Duplicated code: the socket guard `if (!sock) throw …` appears 9×. The `setWindowOpenHandler` body is duplicated at `index.ts:154-162` and `:244-252`. `applyTokens` is duplicated verbatim in `panel-preload.ts:25-52` and `overlay-preload.ts:9-36`.
5. **Dead code**:
   - `usePrismaAuthState` (`auth.ts:199-346`, about 150 lines, never imported).
   - `vectorDbReady` (`auth.ts:127`), which is exported but read by nobody, so S10-04's "callers can distinguish" claim is unimplemented.
   - IPC channels that are never called from the renderer: `ai-chat`, `get-chat-context`, `ai-session-get-autosave`, `duplicate-exported-ai-chat`, `get/set-sync-full-history`, `ping`.
   - `Router.options` (`Router.ts:40`).
6. **`auth.ts` is misnamed.** It holds the DB path, the Prisma adapter Proxy, migrations, sqlite-vec loading and vector init, and is imported as `prisma` by `tools/QueryDatabaseTool.ts:4`, which bypasses DI.
7. **Inconsistent error policy**: `AuthStateRepository.deleteValue` swallows errors (`:50-56`) while `getValue`/`setValue` rethrow. Callers wrap it in `.catch` that can never fire (`WhatsAppConnectionManager.ts:134,153`). `ChatsController.sendMessage` maps every failure, server faults included, to 400 (`ChatsController.ts:59-61`).
8. **Security-policy inconsistency**: HTTP `/api/tools/execute` refuses permission-gated tools like SendMessage because there is "no user in the loop" (`ToolsController.ts:53-61`), yet `/api/messages/send` (`APIServer.ts:86`) sends as the user with the same token. Decide on one policy.
9. **Hardening posture**: main window `sandbox:false` (`index.ts:117`), needed only because the preload imports `path`/`url` for `getPanelPreloadPath`/`getOverlayPreloadPath`, which could be computed in main. `bypassCSP:true` on both custom schemes (`index.ts:7-8`). `SecureFileRegistry.grantedFiles` grows without bound and grants are never revoked (`SecureFileRegistry.ts:6,48-57`).
10. **Types**: 19 `any` in the preload and renderer contract files, e.g. `api.service.ts:268-300` (8 `as any` casts that hide `extensionInstall` returning `{success,manifest}` rather than `ExtensionManifest`), `index.d.ts:56,103`, and `INotificationProvider.ts:7`. `mapChatToListItem` (`ipcHandlers.ts:132-155`) is an identity-typed copy whose purpose isn't documented, and `ChatsController.getChats` skips it.
11. **CI/config**: the only workflow builds a mac DMG. No workflow runs `vitest`, `eslint` or `typecheck` on PRs; typecheck only runs inside `npm run build`. The `publish.url` placeholder is `https://example.com/auto-updates` (`electron-builder.yml:66`).

---

## 2a. IPC contract map

**Where channels are defined:** there is no shared module.

| Layer | File | Kind |
|---|---|---|
| main (app) | `ipcMain.handle/on` literals in `ipcHandlers.ts` (66) plus `index.ts` (`ping`, `wa-skip-sync`) | string literals, arguments typed inline |
| main (kernel) | `kernel/ipc/contributionIpc.ts` (8), `overlayIpc.ts` (4), `panelIpc.ts` (4) | string literals |
| main → renderer events | `webContents.send` literals scattered across `WAWorkerBridge.ts:136-145`, `NotificationService.ts:145`, `KernelUIModule.ts:71`, the kernel UI hosts and `ipcHandlers.ts` (`EVENT_EMBEDDING_*`) | string literals and consts |
| preload | `preload/index.ts` `const api = {…}` (111 methods, untyped object) | string literals |
| preload types | `preload/index.d.ts` `Window['api']`, hand-written; imports renderer types and `main/kernel/ui/IOverlayHost` | declared, never checked against the implementation |
| renderer | `IAPIService.ts` (103 methods) plus `api.service.ts` pass-through adapter | third hand-written copy |

Method sets: the 111 preload methods match the 111 in `index.d.ts` by name. `IAPIService` omits 8 of them. Four are dead (`aiChat`, `getChatContext`, `getAiAutoSave`, `duplicateExportedAiChat`). The other four (`onPanelOpen`, `onPanelClose`, `notifyPanelClosed`, `getPanelPreloadPath`) are used via `window.api` directly in `components/panels/{PanelWebview,SidebarPluginTabs}.tsx`, bypassing the service layer.

**Mismatches found**

| # | Channel | Problem |
|---|---|---|
| M1 | `extension:chat-history`, `extension:chat-send`, `extension:get-docs` | preload calls them; no main handler (B-APP-02) |
| M2 | `extension:chat-push`, `extension:focus` | preload listens; main never emits (B-APP-02) |
| M3 | `toast`, `wa-disconnected` | main emits; no preload listener (B-APP-03) |
| M4 | `${id}-error` (ai-chat-stream) | main sends a `string` (`ipcHandlers.ts:545`); preload/d.ts/IAPIService type it as `Error` (`preload/index.ts:244-246`); consumer uses `String(err)`, so no crash, but the type is wrong |
| M5 | `wa-connected` | payload `{isCatchup}`; `index.d.ts:28` declares `() => void` while `IAPIService.ts:58` declares `(data?)` |
| M6 | `react-message` | main returns `{success,detail,messageId,reaction}`; all three renderer typings say `Promise<void>` |
| M7 | `extension:get-log` | main returns `[]` (`contributionIpc.ts:202`); typed `Promise<string>`; renderer mock returns `''` |
| M8 | `extension:install` / `unload` / `reload` / `uninstall` | main returns `{success, manifest?}`; typed `Promise<ExtensionManifest>` / `Promise<void>` (masked by `as any`) |
| M9 | `kernel:ui:modal:resolve` | preload returns a Promise; `IAPIService.ts:159` types it `void` (rejection is unobservable) |
| M10 | `index-embeddings`, `clear-vectors` | typed `Promise<void>` but resolve on failure (B-APP-04) |
| M11 | `onOverlay*` / `getOverlayPreloadPath` | optional (`?`) in `IAPIService` but always present, which forces pointless guards |
| M12 | `set-ai-options` / `set-notification-preferences` | renderer sends typed `AIChatOptions` / `Partial<NotificationPreferences>`; main accepts `Record<string,unknown>`/`Partial<…>` and persists it unvalidated |

**Verdict:** there is no single source of truth. Recommended target (R-APP-02..04): `src/shared/ipc/contract.ts`, included by both `tsconfig.node.json` and `tsconfig.web.json`. It would export `InvokeMap` (`channel → {args, result}`), `SendMap` and `EventMap`, with shared DTOs moved there from `main/ipc/*.types.ts` and `renderer/src/types`. Then:
- main uses `handle<K extends keyof InvokeMap>(ch, fn)`;
- the preload builds `api` with typed `invoke<K>` and `export type PreloadApi = typeof api`;
- `index.d.ts` becomes `api: PreloadApi`;
- `IAPIService` becomes `PreloadApi` or a documented subset.

A contract test then asserts that every `InvokeMap` key has exactly one registered main handler and every `EventMap` key has at least one emitter.

---

## 3. Test quality

**Source files with no tests at all:** `index.ts`, `ipcHandlers.ts` (645 lines, 66 handlers, zero handler tests; only the `ipcGuards` helpers are tested), `preload/index.ts`, `preload/panel-preload.ts`, `preload/overlay-preload.ts`, `apiServer/Router.ts`, `controllers/{Status,Chats}Controller.ts`, `notification/{TrayService,ElectronNotificationProvider}.ts`, `audio/AudioTranscoderService.ts` (its S11-06/S11-09 fixes are unverified), and `auth.ts` (`initVectorDb`, adapter Proxy). `ServiceContainer.ts` is only exercised indirectly through `createTestServiceContainer` (`tests/helpers.ts:101-124`), which builds the full real graph.

**Weak tests**
- `services/apiServer/APIServer.test.ts`: mocks `http` completely. The bearer-auth middleware, constant-time compare, OPTIONS short-circuit, 404 routing and error handler are never exercised, so the security-critical path is untested. Its mock `toolRegistry.getToolDefinitions` (`:37`) isn't even a real method. Assertions are just `toHaveBeenCalled`.
- `services/CallService.test.ts`: pure delegation test that only checks the mock.
- `services/AuthSettingsService.test.ts:56` "getSyncFullHistory fails closed to false on a read error" is tautological, because the method returns a hard-coded `false`.
- `services/NotificationService.test.ts`: reads `(service as any).provider` (private internals). No coverage of `setPreferences`/login-item, the click handler (`open-chat`), the icon fetch caps (P2-S11-06) or rule 2 (notifyWhenFocused). `vi.mock('fs')` means prefs caching is untested.
- `services/AppProtocolHandler.test.ts` mocks `fs.existsSync → true` globally. There is no test for the `media`/`favourites` hosts or CORS headers.
- `kernel/protocol/pluginProtocol.test.ts` has 3 cases. The directory→index.html, CSP header and missing-hostname paths are untested.
- The renderer `mocks/mockApiService.ts` is typed off `IAPIService`, so it happily implements channels main doesn't have (M1, M7). Hook tests pass while the prod path is broken. This is the clearest "tests pass even if code is broken" case.

**Shared state / harness**
- `tests/electron-mock.ts:7` returns one shared `…/../../../../prisma/test-user-data` directory, which resolves to `/home/user/SmartChat/prisma`, outside the package. `setup.ts:87` cleans `test-user-data-${workerId}`, which never matches, so the directory leaks (it exists on disk now). It is also shared across parallel workers that write `notification_preferences.json` and `ai_preferences.json` via real `NotificationService`/`APIConfigProvider` in `createTestServiceContainer`.
- `setup.ts:10-31` globally `vi.mock`s `EmbeddingService`/`VectorSyncService` for every main test, which is invisible coupling.
- `setup.ts:38,67-70` creates a `prismaTestClient` that nothing uses.
- `electron-mock.ts` lacks `net`, `protocol`, `session`, `dialog`, `Tray`, `nativeImage` and `webContents`, so each test re-mocks electron ad hoc (NotificationService, AppProtocolHandler, pluginProtocol). A shared, richer mock with `ipcMain` that records handlers would enable IPC contract tests.

---

## 4. Refactor proposal

Hotspots (limit parallelism): `src/main/ipcHandlers.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/services/{IAPIService,api.service}.ts`, `src/renderer/tests/mocks/mockApiService.ts`, `src/main/ServiceContainer.ts`, `src/main/index.ts`. Units touching the same hotspot must be serialized: R-02 → R-03 → R-04, and R-06 → R-07 → R-08.

- [R-APP-01] **IPC characterization and contract-drift test** — Goal: a safety net before any IPC work.
  Add a recording `ipcMain` to the electron mock. Add `src/main/tests/ipc/ipcContract.test.ts`, which runs `registerIpcHandlers` plus `registerContributionIpcHandlers` against fakes and compares the registered set with channel literals parsed from `src/preload/*.ts`. Initially mark M1 as a known gap with `it.fails`.
  Add handler-level tests for socket-guard errors, `isTrustedSender` rejections, and `index-embeddings`/`clear-vectors` failure behaviour.
  Files: `src/main/tests/electron-mock.ts`, new `src/main/tests/ipc/*.test.ts`. Depends: none. Risk: low (test-only). Verify: `npx vitest run --project main src/main/tests/ipc`.

- [R-APP-02] **Shared typed IPC contract module** — Goal: create `src/shared/ipc/{contract,dto}.ts` (`InvokeMap`/`SendMap`/`EventMap`), move `main/ipc/*.types.ts` DTOs there, and add `src/shared/**` to both tsconfigs. Types only, with no call-site changes yet.
  Files: new `src/shared/ipc/*`, `tsconfig.node.json`, `tsconfig.web.json`, `src/main/ipc/*.ts` (re-export shims). Depends: none. Risk: low; the risk is tsconfig composite/path mistakes. Safety net: `npm run typecheck`. Verify: typecheck on both projects.

- [R-APP-03] **Typed main-side registration** — Goal: add a `handle<K>()`/`on<K>()` wrapper keyed by `InvokeMap`, and split `ipcHandlers.ts` into `src/main/ipc/handlers/{chat,media,sticker,auth,search,ai,aiSession,notification}.ts`. Each takes a `Pick<ServiceContainer, …>` rather than the whole container. Extract `requireSock()` and move `AIToolInitializer`/`setOnActiveStateSync` out to the composition root. Move `wa-skip-sync`/`ping` out of `index.ts`.
  Files: `src/main/ipcHandlers.ts`, new `src/main/ipc/handlers/*`, `src/main/index.ts` (2 lines). Depends: R-APP-01, R-APP-02. Risk: med (large mechanical move). Safety net: R-APP-01 green before and after. Verify: vitest main, typecheck, and a manual smoke test (send, react, search, AI stream).

- [R-APP-04] **Typed preload and a single renderer interface** — Goal: build the preload `api` from typed `invoke<K>`/`on<K>` helpers, `export type PreloadApi`, reduce `index.d.ts` to `api: PreloadApi`, and make `IAPIService` derive from `PreloadApi`. Delete the `as any` casts, which exposes M4–M9 as compile errors, and fix them. Route the panel `window.api` usages through `IAPIService`.
  Files: `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/services/{IAPIService,api.service}.ts`, `src/renderer/tests/mocks/mockApiService.ts`, `src/renderer/src/components/panels/{PanelWebview,SidebarPluginTabs}.tsx`. Depends: R-APP-02, R-APP-03. Risk: med. **CONTRACT-CHANGE** (preload API types; `onError` payload, `reactMessage` result). Safety net: R-APP-01 plus renderer tests. Verify: `npm run typecheck && npx vitest run`.

- [R-APP-05] **Resolve the orphan channels (B-APP-02, B-APP-03, B-APP-08, dead handlers)** — Goal: decide whether to implement or delete extension chat, and add `onToast`/`onWaDisconnected` wired to `ToastContext`/`App.tsx`. Delete `ai-chat`, `get-chat-context`, `ai-session-get-autosave`, `duplicate-exported-ai-chat`, `get/set-sync-full-history` and `ping`, or document them.
  Files: the preload trio, `IAPIService`/`api.service`, the mock, `ipcHandlers`/handlers, `useExtensionChat.ts`, `ExtensionChatView.tsx`, `ChatLayout.tsx`, `App.tsx`. Depends: R-APP-04. Risk: med. **CONTRACT-CHANGE**. Verify: the contract test in R-APP-01 flips from `it.fails` to passing.

- [R-APP-06] **Remove the partial-object hack and inject environment into the composition root** — Goal: pass an explicit `HistorySyncDependencies` literal to `HistorySyncManager` and drop `{} as unknown as ServiceContainer` in favour of `return {…}`. Add an `AppEnv {userDataPath, appPath, mainDir, dbPath}` parameter to `createServices` so `app`/`__dirname` are no longer imported there. Make `NotificationService` take `preferencesPath` in its constructor and lazy-init, and make `APIServer` load config in `start()`.
  Files: `src/main/ServiceContainer.ts`, `src/main/index.ts`, `services/notification/NotificationService.ts`, `services/apiServer/APIServer.ts`, `src/main/tests/helpers.ts`. Depends: none (serialize with R-03 on `index.ts`). Risk: low–med (construction order). Safety net: `milestone2`/`milestone3` plus NotificationService/APIServer tests. Verify: vitest main and app boot.

- [R-APP-07] **Split `createServices` into per-layer factories** — Goal: `createRepositories(prisma)`, `createContactModule(repos)`, `createMessagingModule(...)`, `createAIModule(...)`, `createWhatsAppModule(...)` and `createInfraModule(env)`, each returning a typed record. `ServiceContainer` becomes their intersection, so the external shape is unchanged. This makes per-module construction in tests possible without the full graph.
  Files: `src/main/ServiceContainer.ts` becomes `src/main/composition/*.ts` plus a re-export. Depends: R-APP-06. Risk: med. Safety net: milestone tests plus a new "each factory builds with fakes" test. Verify: typecheck, vitest main.

- [R-APP-08] **Narrow consumers off the locator** — Goal: `KernelBootstrapper`, `AIToolInitializer` and `WhatsAppConnectionManager` declare `Pick<…>`/ISP deps (they partly do already). `index.ts` passes explicit objects, and `getBus` is removed from the container.
  Files: `kernel/KernelBootstrapper.ts`, `services/ai/AIToolInitializer.ts`, `services/whatsapp/WhatsAppConnectionManager.ts`, `src/main/index.ts`, `tests/kernel/bootstrap.test.ts`. Depends: R-APP-07. Risk: low–med. Verify: vitest main (kernel and whatsapp).

- [R-APP-09] **App lifecycle module and fixes for B-APP-01/05/06** — Goal: extract `AppLifecycle` (window factory, close/quit policy, activate, webview hardening, shutdown sequence) from `index.ts` behind injected electron seams. Add `before-quit`, restore on `activate`, null the window on `closed`, and dedupe the window-open handler.
  Files: `src/main/index.ts`, new `src/main/app/{AppLifecycle,windowFactory,webviewHardening}.ts`, new tests. Depends: R-APP-01 (the electron mock). Risk: med (startup ordering, S13-01 bus buffering). Safety net: new lifecycle unit tests plus a manual mac/Windows quit and tray check. Verify: `npm run dev`, then Cmd+Q, tray quit, close with and without minimizeToTray.

- [R-APP-10] **APIServer robustness and tests** — Goal: add an `'error'` listener (B-APP-07), use real-`http` tests on port 0 for auth/401/404/OPTIONS/500, decide the `/api/messages/send` policy, and map server-side errors to 500.
  Files: `services/apiServer/{APIServer,Router}.ts`, `controllers/ChatsController.ts`, `tests/services/apiServer/*`. Depends: none. Risk: low. Verify: vitest apiServer.

- [R-APP-11] **Error-surfacing for embedding IPC (B-APP-04)** — Rethrow from `index-embeddings`/`clear-vectors`, and add a renderer test in which a rejected `indexEmbeddings` clears progress.
  Files: `ipcHandlers.ts` (or `handlers/search.ts` after R-03), `renderer/src/components/chat/ChatList.tsx` test. Depends: R-APP-01. Risk: low.

- [R-APP-12] **Test harness hygiene** — Use a per-worker userData dir in `electron-mock.ts` that matches the `setup.ts` cleanup, keep it inside the package's `prisma/`, remove the unused `prismaTestClient`, and make the global `EmbeddingService` mock opt-in. Add a CI workflow for `npm run typecheck`, `lint` and `vitest run` on ubuntu.
  Files: `src/main/tests/{setup,electron-mock}.ts`, `.github/workflows/ci.yml`. Depends: none. Risk: low–med (the global mock removal may surface hidden test coupling). Verify: `npx vitest run` twice in parallel with no residue in `/home/user/SmartChat/prisma`.

- [R-APP-13] **Dead code and naming in `auth.ts`** — Delete `usePrismaAuthState`. Either gate deep search on `vectorDbReady` or delete it. Rename `auth.ts` to `db/prismaClient.ts` plus `db/vectorStore.ts` with a re-export shim, and inject `prisma` into `QueryDatabaseTool`.
  Files: `src/main/auth.ts`, `src/main/index.ts`, `src/main/ServiceContainer.ts`, `src/main/tools/QueryDatabaseTool.ts`. Depends: R-APP-06. Risk: low. Verify: typecheck, vitest main, app boot, deep search.

---

## 5. Top 5

1. There is no typed IPC source of truth. Channels are string literals in 5 main files, an untyped preload object and 3 hand-written type copies. This has already produced orphan channels: extension chat has no backend (B-APP-02), and `toast`/`wa-disconnected` have no listener (B-APP-03).
2. macOS quit is broken. With the default `minimizeToTray`, Cmd+Q, Dock quit and OS logout are cancelled because nothing sets `isQuitting` on `before-quit` (B-APP-01, `index.ts:123`). The Dock also can't restore the hidden window (B-APP-05).
3. `ServiceContainer` is a Pure-DI root used as a service locator. The whole 47-entry bag goes to 4 consumers, and a needless partially-constructed object is passed to `HistorySyncManager`. Safe path: explicit deps, then an injected `AppEnv`, then per-layer factories, then `Pick<>`-typed consumers (R-APP-06..08).
4. `ipcHandlers.ts` (66 handlers) and the preload have no tests at all, and `APIServer` auth is untested. The renderer's `IAPIService` mock implements channels main lacks, so tests pass over broken paths. Build the contract and characterization test first (R-APP-01).
5. Error swallowing at the IPC edge hides real failures: `index-embeddings` leaves the progress bar stuck (B-APP-04), and an APIServer port clash becomes an uncaught exception (B-APP-07). There is also no CI job running tests, lint or typecheck on PRs.
