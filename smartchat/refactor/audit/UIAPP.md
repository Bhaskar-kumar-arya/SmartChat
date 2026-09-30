# UIAPP audit — renderer (App shell, ai/common/extensions/overlays/panels, hooks, context, services, utils, types)

Scope read in full: `src/renderer/src/{App,main,env.d}.tsx`, `components/{ai,common,extensions,overlays,panels}/**`,
`hooks/**`, `context/**`, `services/**`, `utils/**`, `types/**` (~9.2k LOC incl. 730 LOC of emoji data),
plus `src/preload/index.d.ts` and the relevant preload / main IPC registrations for contract checks.
Prior trackers (`bug-audit-frontend/TRACKER.md` F2, F6, F8–F12) cross-checked; items below are new or mark a prior fix
as wrong or incomplete.

---

## 1. Bugs (confirmed)

- [B-UIAPP-01] high `src/preload/index.ts:355-368` + `src/main/kernel/ipc/contributionIpc.ts:202-211` — renderer extension-chat / docs / focus IPC channels have **no main-process handler**.
  `extension:chat-history`, `extension:get-docs` (invoke), `extension:chat-send` (send), `extension:chat-push`, `extension:focus` (on) are not registered anywhere in `src/main` (checked with grep, tests excluded). So `useExtensionChat` (hooks/useExtensionChat.ts:40-48) always rejects with "No handler registered", `send()` goes nowhere, and the whole "dedicated chat" UI (ExtensionCard "💬 Chat", ExtensionChatView) is dead. `extension:get-log` is a stub `async () => []` that returns an **array**, but the renderer types it as `string`. `ExtensionLogViewer.tsx:37` renders `[] || '(no log output yet)'`, so it shows an empty `<pre>` and never the placeholder, and it polls the stub every 2 s.
  Tests pass only because `mockApiService.ts:178-183` stubs these methods with the "right" shapes.
  Fix: decide to either implement the handlers (see R-UIAPP-04) or remove the dead UI, hook and preload methods. **CONTRACT-CHANGE.**

- [B-UIAPP-02] med `src/renderer/src/components/common/WaveformPlayer.tsx:63` (regression from the F5-09 fix) — the effect deps now include `peaks`, but `AudioMessage.tsx:9` builds `peaks` with `Array.from(...).map(...)` on **every render**.
  Any re-render of the message row, such as opening the dropdown or reaction menu (`MessageItem` local state, `MessageItem.tsx:217-229`), runs `ws.destroy()` and creates a new WaveSurfer. A playing voice note stops and resets to 0:00.
  Fix: `useMemo` peaks in AudioMessage keyed on the waveform, or keep `peaks`/`preDuration` in refs and depend only on `url`/`isPtt`.

- [B-UIAPP-03] med `src/renderer/src/components/ai/hooks/useAIStream.ts:218-258` — `executeToolCall` continues into whatever session is current after `await api.executeTool`.
  The F8-01 guard covers the stream end/error handlers only. Scenario: approve a slow tool, then pick another session in History or click New Chat. `handleAbort()` does nothing because no channel is open during tool execution. When the tool returns, `messagesRef.current` holds the **new** session's messages: the hidden tool-result message and an empty AI bubble are appended to it, and `startStream` runs with the new session as `streamSessionId`. The answer is written into, and auto-saved to, the wrong session. The same continuation after unmount opens a stream that no one aborts.
  Fix: snapshot `activeSessionIdRef.current` (and `isMountedRef`) before the await, and bail if either changed.

- [B-UIAPP-04] med `src/renderer/src/App.tsx:34-42` — any `wa-connected` after the app is `ready` tears the whole UI down.
  On a transient socket reconnect the worker publishes `wa-connected {isCatchup:true}` (`workerConnectionHandler.ts:50`, reached from `:160-176` when `hasReceivedPendingNotifications` is false, which `resetCatchUp()` sets at `:91`). App then switches `appState` to `'connected'`, so `ChatLayout` unmounts. The open chat, scroll position, composer draft and staged files are lost, and the AI stream is aborted by the unmount cleanup. The app shows "Reconnecting…" until sync completes or the 60 s safety timeout fires. With `isCatchup:false` it goes to the full sync screen instead.
  Fix: once `ready`, keep `ready` on reconnect and show a non-blocking banner (use `appStateRef`).

- [B-UIAPP-05] med `src/renderer/src/hooks/useMentions.ts:22-40` — `getGroupParticipants` has no stale-jid guard.
  Switch from group A to group B while A's request is slower. A's result lands last, so B's `@` menu lists A's members, and picking one sends a mention JID that is not in B. The F12-03 claim that every instance was fixed does not hold here. `api` is also missing from the deps at `:34`.
  Fix: an `alive`/`jid` check in the effect.

- [B-UIAPP-06] low `src/renderer/src/components/common/ProfilePicture.tsx:56-72` — F11-02 was fixed only partly.
  The tracker names `handleImageError`, but only the preview effect got the `alive` guard. If the `<img>` for contact A errors and the forced refresh resolves after the component switched to B (the header instance is reused across chats), A's `freshUrl` is painted as B's avatar, or `setLoadError(true)` hides B's valid picture.
  Fix: compare against a `jidRef` after the await.

- [B-UIAPP-07] low `src/renderer/src/components/extensions/ExtensionManager.tsx:25` + `hooks/useExtensionManager.ts:30-36` — `if (!isOpen) return null` runs **after** `useExtensionManager()`, and ExtensionManager stays mounted for the whole life of ChatList (`ChatList.tsx:619`).
  The list is fetched once when ChatList mounts and **never refreshed on reopen**, so it goes stale after plugins change (`onContributionsUpdated` is not wired in). `selectedId` and `installError` persist across open/close. The F9-10 rationale ("unmounts entirely when closed") is wrong, so the `aliveRef` fix it describes never runs.
  Fix: call `refresh()` when `isOpen` turns true, or mount the component conditionally.

- [B-UIAPP-08] low `src/renderer/src/components/extensions/ExtensionManager.tsx:118,121` — `onReload={() => reload(ext.id)}` and `uninstall(ext.id)` are floating promises. A backend throw becomes an unhandled rejection and the user gets no feedback, unlike `handleToggle`.
  Fix: route them through a guarded handler plus `showError`.

- [B-UIAPP-09] low `src/renderer/src/components/ai/AISettingsModal.tsx:263-266` — `api.setAiAutoSave(checked)` is a floating promise, so it can reject unhandled.
  It also double-writes the preference: `onOptionsChange` → `AIChatSidebar.handleUpdateOptions` → `api.setAiOptions({...autoSaveChats})` stores it in AI options, and `ai-session-set-autosave` stores it in a second preference (`ipcHandlers.ts:589-603`). The two can diverge.
  Fix: keep one source of truth.

- [B-UIAPP-10] low `src/renderer/src/components/ai/CitationPill.tsx:21,50` — `resolve(index).then(...)` has no `.catch`, and `onClick={() => handleCitationClick(index)}` is unawaited. A rejected `resolveCitation` IPC (for example a deleted session) is an unhandled rejection on every pill mount while a message streams.
  Fix: catch the rejection and render the invalid-citation state.

SUSPECT (not confirmed):
- `OverlayShell.tsx:49-56` collects `--wa-*` tokens by iterating `getComputedStyle(documentElement)`. Chromium may not enumerate custom properties there (PanelWebview deliberately scans the stylesheets instead), so overlays may get `{}` tokens and render unthemed.
- `AIChatSidebar.tsx:134-140`: during `await createSession` the input is not disabled (`loading` is still false and there is no channel). A quick second Enter starts a second concurrent stream, and `abort` can only reach the last channel.
- `useCitation.ts:14` module cache is never evicted and is keyed only by sessionId. If the backend renumbers citations for a session (retry, clone into the same id), pills resolve stale entities.
- Tests that use `useChatNavigation`/`useCitationActions` do not call `__resetNavigationBus`. The 400 ms dedupe window (`navigationBus.ts:27`) can swallow identical intents across tests, which could make them flaky.

---

## 2. Code quality / design issues (ranked)

1. **Four hand-maintained copies of the IPC contract, and the "typed" one is silently `any`.**
   The copies are `preload/index.ts` (471 LOC, implementation), `preload/index.d.ts` (172, `Window.api`), `services/IAPIService.ts` (170) and `services/api.service.ts` (306, a one-line pass-through per method).
   `index.d.ts:1-17` imports from `'../renderer/src/types'`, **a barrel that does not exist** (there is no `types/index.ts`). `skipLibCheck` hides the TS2307, so `ChatItem`, `MessageItem`, `AIChatMessage` etc. in `Window.api` resolve to `any`. Verified with a probe: `[{totallyWrong:1}]` is assignable to `ReturnType<getChats>`. `api.service.ts` therefore type-checks against nothing.
   There are also 10 `any` casts (`api.service.ts:268-300`), and the preload uses `(msg: any)` / `(req: unknown)` callbacks. Drift already visible:
   - `onWaConnected`: the d.ts says `() => void`, but it is called with `{isCatchup}`.
   - `extensionList`: the d.ts omits `isLoaded`.
   - `extensionInstall`: the main process returns `{success, manifest}`, but it is typed as `ExtensionManifest`.
   - `resolveModal`: the preload returns a Promise, but `IAPIService` says `void`.
   - `extensionGetLog` returns `[]`, not `string` (see B-01).
   - Methods declared but unused by the renderer: `aiChat`, `getChatContext`, `getAiAutoSave`, `duplicateExportedAiChat`, `extensionGetDocs`, `onExtensionFocus`.
2. **Renderer bypasses its own service layer.** `PanelWebview.tsx:65,110-111` and `SidebarPluginTabs.tsx:125-132` use `window.api.{getPanelPreloadPath,notifyPanelClosed,onPanelOpen,onPanelClose}` directly. The panel API is not in `IAPIService`, so these files cannot use the mock and have no tests. `Versions.tsx:4` uses `window.electron` (and the component is dead code; see 9). Also, 7 `IAPIService` members are optional (`onOverlayShow?` …, `IAPIService.ts:162-168`), which forces `?.` guards in ModalPortal/OverlayShell although the preload always provides them.
3. **Renderer imports main-process source files for types**: `IAPIService.ts:158,162`, `ModalPortal.tsx:10`, `OverlayShell.tsx:4` (`main/kernel/ui/IOverlayHost`), `contribution.types.ts:1`, `utils/whenCondition.ts:1-5`, `utils/contributionUtils.tsx:2`. In the other direction, the preload `.d.ts` imports renderer types. This is why `tsc -p tsconfig.web.json` (composite) emits dozens of TS6307 errors; `npm run typecheck:web` passes only with `--composite false`. There is no `src/shared` module.
4. **Type duplication between renderer and main** (identical or divergent copies):
   - `CitationEntity` (`types/ai/citation.types.ts` vs `main/services/ai/citations/ICitationEmitter.ts`)
   - `ModelInfo` (`types/ai/model.types.ts` vs `IBaseAIProvider.ts:1`)
   - `NotificationPreferences` (vs `INotificationService.ts:11`)
   - `SearchResultItem`/`SearchResults`/`SearchFilters` (vs `ISearchService.ts`; `fromDate` is `string` in the renderer and `Date` in main, converted at `ipcHandlers.ts:377`)
   - `ModalRequest` (`ModalPortal.tsx:12-16` vs `IOverlayHost.ts:1-5`)
   - `ExecuteContributionOpts` (`types/contribution.types.ts:12`, `context?` optional, vs `utils/contributionUtils.tsx:6`, required)
   - `GroupParticipant` (`types/group.types.ts`, unused) vs the inline type in `IAPIService.ts:38-40` vs a local `Participant` in `useMentions.ts:4-9`
   - renderer `ExtensionManifest.dedicatedChat` (`types/extension.types.ts:14-18`) does not exist in the SDK `PluginManifest`, which is more evidence that the extension-chat path is legacy.
5. **Duplicated modal logic, 5 different patterns.** BaseModal (`overlays/BaseModal.tsx`) is the intended primitive, but:
   - Two components are both called `ConfirmModal` with different APIs: `common/ConfirmModal.tsx` (default export, BaseModal-based) and `overlays/ConfirmModal.tsx` (named, plugin tier-1).
   - Inline confirms are re-implemented in `AIChatExportButton.tsx:84-106` (BaseModal + `ai-modal-confirm-overlay` with `position: static`) and `AIChatHistoryModal.tsx:86-100` (overlay inside a modal, not BaseModal).
   - `ExtensionManager.tsx:60-61` hand-rolls an overlay (no Escape, focus trap, `inert` or scroll lock) and uses `window.confirm` (`:120`).
   - `OverlayShell.tsx:140-146` hand-rolls a backdrop, and ModalPortal needs a second Escape handler for it (`ModalPortal.tsx:71-85`).
   - The "X" close SVG is copy-pasted in 6 places.
6. **Duplicated logic in utilities.**
   - Presence text: `PresenceContext.getActivePresence` (`:128-169`, "X is typing...") vs `utils/presenceUtils.getPresenceStatusText` ("X typing...").
   - Theme-token extraction: `PanelWebview.tsx:18-53` (stylesheet scan, cached) vs `OverlayShell.tsx:49-56` (computed-style scan).
   - ReactMarkdown plugin/`urlTransform` config: 4 copies in `AIMessageBubble.tsx:22,29,120,182`; `urlTransform` at `:20` is defined then not used at `:29`.
   - Mention-highlight splitting: `AIMessageBubble.tsx:15-41` vs `AISmartInput.tsx:31-33,195-214`.
   - `.animate-spin`: `setup.css:582` and `shared.css:3`.
7. **State management is mixed but mostly reasonable.** There are 4 contexts (API, Toast, Contribution, Presence), 23 `useAPI()` consumers and local hook state. Weak spots:
   - `useAIStream` hand-syncs 6 refs mirroring state (`:24-56`), keeps `startStream` as `useCallback([])`, and closes over `executeToolCall`/`saveCurrentMessages` from the first render. This is the fragility F8-11 left open, and B-03 comes from it.
   - Module-level singletons with no reset or eviction: `globalCitationCache`/`inFlightCitations` (useCitation.ts:14-16), `modalStack` (BaseModal.tsx:16), `cachedThemeTokens` (PanelWebview.tsx:16), navigationBus state.
   - Prop drilling: `chatList` flows AIChatSidebar → AIMessageBubble → AISmartInput (edit mode), and it is fetched once (`getChats(1,100)`, `AIChatSidebar.tsx:86`) and never refreshed.
   - `PresenceContext` passes a new value object on every render, so every consumer re-renders on every presence event.
8. **Stale or contradictory comments that mislead maintainers.**
   - `useAIChatSessions.ts:25-30` says "Does NOT call setActiveSessionId", but `:35` does.
   - `ExtensionManager.tsx:16` says "zero direct api calls", but it calls `api.selectFile` at `:30`.
   - `ProfilePicOverlay.tsx:41-43` correctly says Tailwind is not compiled, while `ProfilePicture.tsx:88,107` and `App.tsx:145,218,250` still use utility classes.
9. **Dead code**:
   - `hooks/useIsMounted.ts` (0 users; the F12-03 "shared primitive" was never adopted)
   - `components/common/Versions.tsx` (0 users, but tested)
   - `SidebarPluginNavItems` (`SidebarPluginTabs.tsx:13-42`, 0 users)
   - the `onFocusChange` path of `useSidebarPanelFocus` (only caller passes nothing; `:133-137` would also run a side effect inside a setState updater)
   - `hooks/usePresence.ts` re-export shim
   - `types/group.types.ts`
   - `types/componentProps.ts` is used only by components/chat.
10. **Inconsistent error handling**: 47 `console.error` calls in the slice versus a `ToastContext` that only `useAIStream` uses (1 `showError` call). The AI export, clone, delete and rename flows, extension reload/uninstall, and the provider-key save all fail silently.
11. **Magic strings**: provider list and model ids hard-coded in `AIChatSidebar.tsx:28-33` (default `'gemini:gemma-4-31b-it'`), `AISettingsModal.tsx:16,49-58,134-138`, `AISmartInput.tsx:217-225` (a friendly-name table that maps `gpt-oss-120b` to "Llama 3.3 120B"). There are 3 separate provider unions.
12. **CSS**:
    - `main.css:1` has `@import 'tailwindcss'`, but no `@tailwindcss/vite`/PostCSS plugin is configured (`electron.vite.config.ts`). The v4 package's raw CSS is imported with its directives unprocessed, and every utility class is dead.
    - `sidebar.css` (1949 LOC) is imported twice (`main.css:9` and `ChatLayout.tsx:14`).
    - Selectors are defined in two files: `ai.css` vs `sidebar.css` (the `.ai-action-btn`/`.ai-edit-*`/`.ai-cancel-btn` family, 9 selectors), `messages.css` vs `shared.css` (`.dropdown-*`, `.date-separator`), `layout.css`/`chat-main.css` vs `sidebar.css` (`.chat-layout`, `.chat-main`).
    - Keyframes `spin`, `fadeIn`, `slideUp` and `slideInRight` are each defined twice; globally the last definition wins.
    - `!important`: 24 in `picker.css`, 22 in `messages.css`.
    - Heavy inline `style={{…}}` in AIToolCard, OverlayShell, SettingsModal, ToastContext, ConfirmModal and PanelWebview.
13. **External CDN at runtime**: `utils/editorUtils.ts:52` builds `<img src="https://cdn.jsdelivr.net/...emoji-datasource-apple...">` for every emoji in the composer, and `EmojiText` uses emoji-picker-react's APPLE style, which also comes from the CDN. This leaks usage to a third party and breaks offline.

---

## 3. Test quality

Infrastructure:
- `tests/mocks/mockApiService.ts` **is** annotated `: IAPIService`, so a missing or extra method fails `typecheck:web` (tests are included in `tsconfig.web.json`). That part cannot drift.
- **Values can drift**, though: every entry is an untyped `vi.fn()` (`Mock<any>`), plus 9 `as any` casts. Already wrong today:
  - `getNotificationPreferences` resolves `{soundEnabled, notificationsEnabled, previewEnabled}`, which is not `NotificationPreferences`.
  - `getAiOptions` → `{model, temperature}`
  - `searchAll` → an extra `media: []`
  - `createAiSession` → numeric `createdAt`
  - `extensionGetLog` → `''` (real: `[]`)
  - extension-chat methods that have no backend at all
  Fix: build the mock with a helper typed as `vi.fn<IAPIService[K]>()` so return types are checked.
- `IAPIService` itself is not tied to the preload (see §2.1), so "typed against IAPIService" does not guarantee the mock matches production.
- No event-emitter helper. About a dozen tests hand-roll `let cb; onX: vi.fn(c => { cb = c; return () => {} })` (e.g. both ModalPortal suites, useAIStream, usePresence, useExtensionChat).
- Two suites bypass the typed mock with `mockApi: any`: `tests/components/overlays/ModalPortal.test.tsx:8`, `OverlayShell.test.tsx`.
- **Duplicate suites**: `tests/components/ModalPortal.test.tsx` (tier-1 modals) and `tests/components/overlays/ModalPortal.test.tsx` (webviews).
- Test layout does not mirror source: chat hooks (`components/chat/hooks/*`) are tested under `tests/hooks/` next to shared hooks, and `components/ai/hooks/*` tests also sit in `tests/hooks/`.
- `setup.ts` resets no module singletons (navigationBus, BaseModal `modalStack`, citation cache). `useCitation.test.tsx` works around the shared cache by using a unique sessionId per test (`session-memo`, `session-neg`, `session-dedupe`).

Source files with NO tests:
- `App.tsx` (the whole setup/sync state machine, including B-04)
- `panels/PanelWebview.tsx`, `panels/SettingsPluginPage.tsx`, `panels/SidebarPluginTabs.tsx` (incl. `useSidebarPanelFocus`)
- `overlays/AlertModal.tsx` (only through ModalPortal)
- `common/MessageErrorBoundary.tsx`
- `utils/parseToolCall.ts` (used by both the tool-call auto-execution and rendering paths)
- `utils/bigintTime.ts`
- `hooks/useIsMounted.ts` (dead), `services/api.service.ts`

Weak tests:
- `useAIStream.test.tsx`: 5 tests, and **none** cover `executeToolCall`, `declineToolCall`, `handleRetry`, no-permission auto-execution, the `onError` path or the auto-save timer's `!parsed` branch. This is the riskiest logic in the slice (B-03).
- `AIChatSidebar.test.tsx`: only asserts that buttons open modals. There is no send flow, no session creation on the first message, no switch or delete during a stream.
- `ExtensionLogViewer.test.tsx` and `useExtensionChat.test.tsx` pass against the mock only; production has no handler, or a `[]` stub (B-01). These are textbook tests of the mock.
- `Versions.test.tsx` tests a dead component. `WaveformPlayer.test.tsx` mocks WaveSurfer and never re-renders with new `peaks`, so B-02 slipped through.
- `FormModal.test.tsx` has 34 lines and no validation or error-path cases; `ModalPortal.test.tsx` covers them only partly.
- `ExtensionManager.test.tsx`: no toggle, reload, uninstall or reopen cases (B-07, B-08). `useMentions.test.tsx`: no stale-response case (B-05).
- Many assertions are `toHaveBeenCalled[With]`-only, e.g. SettingsModal toggle, ExtensionCard callbacks, useAIChatSessions rename/delete/clone (one test covering 4 operations at `useAIChatSessions.test.tsx:96`).

---

## 4. Refactor proposal (UIAPP)

Hotspots that limit parallelism: `src/preload/index.ts` and `src/preload/index.d.ts` (shared with the MAIN/IPC slices), `services/IAPIService.ts`, `tests/mocks/mockApiService.ts`, `components/chat/ChatLayout.tsx` and `ChatList.tsx` (the CHAT slice, which hosts most consumers), `styles/main.css`.

- [R-UIAPP-01] Single source of truth for the renderer↔preload contract
  - Goal: create `src/shared/ipc/rendererApi.ts`, which exports `RendererApi` using the real DTO types. The preload object is written `satisfies RendererApi`. `index.d.ts` declares `api: RendererApi` and fixes the missing-barrel import. `IAPIService` becomes `type IAPIService = RendererApi` (or `Omit` + adapters). `api.service.ts` shrinks to adapters only (`resolveAllCitations` Map conversion). Delete all `as any`.
  - Files: `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/services/{IAPIService,api.service}.ts`, new `src/shared/ipc/rendererApi.ts`, `tsconfig.web.json` / `tsconfig.node.json` (include `src/shared`).
  - Depends on: none.
  - Risk: med. Turning types on will surface real mismatches (see §2.1) that must be resolved one by one. Runtime behaviour is unchanged.
  - Safety net: `npm run typecheck`. Add a unit test that asserts `Object.keys(preloadApi)` equals the key list of the contract.
  - Verify: `npm run typecheck && npx vitest run --project renderer`, then smoke-run the app (QR, chat, AI, a plugin modal).
- [R-UIAPP-02] Route panel APIs through the service layer; remove direct `window.*`
  - Goal: add `onPanelOpen`/`onPanelClose`/`notifyPanelClosed`/`getPanelPreloadPath` to `IAPIService`. `PanelWebview` and `useSidebarPanelFocus` use `useAPI()`. Make the overlay methods non-optional. Delete `Versions.tsx` and its test, and `SidebarPluginNavItems`.
  - Files: `services/IAPIService.ts`, `services/api.service.ts`, `components/panels/{PanelWebview,SidebarPluginTabs}.tsx`, `components/overlays/{ModalPortal,OverlayShell}.tsx`, `components/common/Versions.tsx`, `tests/mocks/mockApiService.ts`, new `tests/components/panels/*.test.tsx`.
  - Depends on: R-UIAPP-01 (preferred) or none.
  - Risk: low.
  - Safety net: write PanelWebview and useSidebarPanelFocus characterization tests first (the listener subscribe/unsubscribe, `notifyPanelClosed` on unmount, the retry nonce).
  - Verify: renderer tests; `grep -rn "window\.\(api\|electron\)" src/renderer/src` returns only `api.service.ts`.
- [R-UIAPP-03] Typed mock and test-infra cleanup
  - Goal: rewrite the mock factory with `fn<K extends keyof IAPIService>(impl)` so it is typed as `IAPIService[K]`, and fix the drifted defaults. Add an `emit(event, payload)` helper for `on*` subscriptions. Migrate the two `any` mocks, merge the two ModalPortal suites, add a `setup.ts` `afterEach` that resets navigationBus and the citation cache (export a reset), and move the chat-hook tests under `tests/components/chat/hooks/`.
  - Files: `tests/mocks/mockApiService.ts`, `tests/setup.ts`, `tests/testUtils.tsx`, `tests/components/**/ModalPortal.test.tsx`, `tests/components/overlays/OverlayShell.test.tsx`, `hooks/useCitation.ts` (export a reset only).
  - Depends on: R-UIAPP-01 (for accurate types).
  - Risk: low (tests only).
  - Safety net: the existing suite must stay green.
  - Verify: `npx vitest run --project renderer`, `npm run typecheck:web`.
- [R-UIAPP-04] Resolve the dead extension-chat/log IPC — **CONTRACT-CHANGE**
  - Goal: product decision. Either (a) implement the `extension:chat-history|chat-send|chat-push|focus|get-docs` handlers and make `get-log` return a string, or (b) delete `useExtensionChat`, the ExtensionChat views, the ExtensionCard chat button, `extensionGetDocs`/`onExtensionFocus`/`extensionChat*` from preload/IAPIService/mock, and the legacy `dedicatedChat` type.
  - Files: (b) `src/preload/index.ts`, `index.d.ts`, `services/*`, `hooks/useExtension{Chat,Log}.ts`, `components/extensions/*`, `components/chat/ExtensionChat/*` (CHAT slice, coordinate), `types/extension.types.ts`, `main/kernel/ipc/contributionIpc.ts`.
  - Depends on: R-UIAPP-01.
  - Risk: med, because it crosses slices.
  - Safety net: a main-side test asserting that every channel the preload invokes has a registered handler. Write it first; it fails today.
  - Verify: that test, plus a manual check of Extension Manager.
- [R-UIAPP-05] AI stream correctness and characterization
  - Goal: add tests for `executeToolCall`/`declineToolCall`/`handleRetry`/auto-exec/`onError`. Fix B-03 (session and mount snapshot around `await executeTool`). Consider collapsing the refs into a `useReducer` plus one "stream context" ref. Also fix B-09 and B-10.
  - Files: `components/ai/hooks/useAIStream.ts`, `components/ai/AIChatSidebar.tsx`, `components/ai/AISettingsModal.tsx`, `components/ai/CitationPill.tsx`, `tests/hooks/useAIStream.test.tsx`, new `tests/utils/parseToolCall.test.ts`.
  - Depends on: none.
  - Risk: med. This is timing-sensitive code with a 30 ms drip and a 100 ms auto-save timer.
  - Safety net: the new characterization tests must land **before** any restructuring (fake timers).
  - Verify: renderer tests; manual run of a tool call while switching sessions.
- [R-UIAPP-06] Modal consolidation
  - Goal: rename `overlays/ConfirmModal` → `PluginConfirmModal` (and AlertModal/FormModal to the `Plugin*` prefix). ExtensionManager uses BaseModal plus common ConfirmModal instead of `window.confirm`. OverlayShell renders inside BaseModal (remove ModalPortal's extra Escape handler). AIChatExportButton and AIChatHistoryModal use common ConfirmModal. Extract a `CloseIcon`.
  - Files: `components/overlays/*`, `components/common/ConfirmModal.tsx`, `components/extensions/ExtensionManager.tsx`, `components/ai/{AIChatExportButton,AIChatHistoryModal,AISettingsModal}.tsx`, `styles/modals.css`, `styles/extension-manager.css`, related tests.
  - Depends on: R-UIAPP-03 (tests use the emit helper).
  - Risk: low-med (focus and Escape stacking between webview overlays and tier-1 modals).
  - Safety net: BaseModal and ModalPortal tests for Escape ordering (webview under modal) and focus restore; ExtensionManager uninstall-confirm test.
  - Verify: tests plus a manual keyboard pass.
- [R-UIAPP-07] Renderer bug-fix batch (small, independent)
  - Goal: fix B-02 (memoize `peaks` in AudioMessage, or keep peaks in refs in WaveformPlayer), B-05 (useMentions stale guard), B-06 (ProfilePicture jidRef), B-07 and B-08 (ExtensionManager refresh on open plus guarded reload/uninstall).
  - Files: `components/common/{WaveformPlayer,ProfilePicture}.tsx`, `components/chat/messages/AudioMessage.tsx` (CHAT slice, 1-line), `hooks/{useMentions,useExtensionManager}.ts`, `components/extensions/ExtensionManager.tsx`, and their tests.
  - Depends on: none.
  - Risk: low.
  - Safety net: add a failing test for each bug first (e.g. rerender WaveformPlayer with an equal-content new `peaks` array and assert WaveSurfer.create was called once).
  - Verify: renderer tests.
- [R-UIAPP-08] App connection state machine
  - Goal: extract `useConnectionState()` from `App.tsx` (reducer: initializing/qr/connected/syncing/ready plus sessionReplaced). Fix B-04: keep `ready` on reconnect and expose a `reconnecting` flag for a banner. Add tests for all transitions.
  - Files: `App.tsx`, new `hooks/useConnectionState.ts`, new `tests/App.test.tsx` / `tests/hooks/useConnectionState.test.ts`, possibly `styles/setup.css`.
  - Depends on: none.
  - Risk: med. It changes the UX on reconnect; coordinate with the WA worker owner about catch-up semantics.
  - Safety net: characterization tests of the current transitions first.
  - Verify: tests; manually toggle the network while in `ready`.
- [R-UIAPP-09] Shared DTO types and utility dedupe
  - Goal: move `CitationEntity`, `ModelInfo`, `NotificationPreferences`, `Search*`, `ModalRequest`, `WebviewOverlayRequest`, `ExecuteContributionOpts` and the contribution types to `src/shared/types/*`, and re-export them from the renderer `types/*` barrels. Delete `types/group.types.ts` and the `useMentions` `Participant` type. Unify presence text formatting into `utils/presenceUtils.ts`, used by PresenceContext and ChatList. Share one ReactMarkdown config.
  - Files: `src/shared/types/*`, `src/renderer/src/types/*`, `src/main/services/{ai/citations/ICitationEmitter,ai/providers/IBaseAIProvider,notification/INotificationService,search/ISearchService}.ts` (MAIN slice, type-only), `main/kernel/ui/IOverlayHost.ts`, `context/PresenceContext.tsx`, `utils/{presenceUtils,contributionUtils}.tsx`, `components/ai/AIMessageBubble.tsx`, `components/overlays/ModalPortal.tsx`.
  - Depends on: R-UIAPP-01.
  - Risk: low (type-only apart from the presence string, where the user-visible text is unified).
  - Safety net: presence tests (usePresence, presenceUtils) with both phrasings pinned first.
  - Verify: `npm run typecheck` and full vitest.
- [R-UIAPP-10] CSS hygiene
  - Goal: decide on Tailwind. Either wire `@tailwindcss/vite` or remove `@import 'tailwindcss'` and the dependency, replacing the ~10 utility-class usages with CSS classes. Remove the second `sidebar.css` import. Dedupe the `ai.css`/`sidebar.css`, `messages.css`/`shared.css` and layout selectors and the duplicate keyframes. Move ToastContext inline styles to CSS.
  - Files: `styles/*.css`, `main.css`, `App.tsx`, `components/common/ProfilePicture.tsx`, `components/overlays/{Alert,Confirm,Form}Modal.tsx`, `context/ToastContext.tsx`, `components/chat/ChatLayout.tsx` (1 import line), `package.json`.
  - Depends on: none.
  - Risk: med (visual regressions; no visual tests exist).
  - Safety net: before and after screenshots of the setup screen, chat, AI sidebar, modals and picker.
  - Verify: `npm run build`, manual visual pass.
- [R-UIAPP-11] Dead-code sweep and hook placement
  - Goal: remove `useIsMounted`, the `usePresence.ts` shim (update imports), `SidebarPluginNavItems`, and the unused preload methods (`aiChat`, `getChatContext`, `getAiAutoSave`, `duplicateExportedAiChat`; **CONTRACT-CHANGE** for the preload API). Consolidate the AI auto-save preference into one store (B-09). Fix the stale comments listed in §2.8.
  - Files: `hooks/{useIsMounted,usePresence}.ts`, `components/panels/SidebarPluginTabs.tsx`, `components/ai/hooks/useAIChatSessions.ts`, `components/extensions/ExtensionManager.tsx`, `src/preload/index.ts`, `index.d.ts`, `main/ipcHandlers.ts` (autosave handlers, MAIN slice).
  - Depends on: R-UIAPP-01, R-UIAPP-02.
  - Risk: low.
  - Safety net: typecheck and `grep` for usages.
  - Verify: typecheck plus full vitest.

---

## 5. Top 5

1. The renderer IPC contract is maintained by hand in 4 places, and the `Window.api` typing imports a barrel that does not exist (`preload/index.d.ts:17`). As a result every DTO is silently `any` and `api.service.ts` checks nothing (R-UIAPP-01).
2. The extension-chat/docs/focus IPC channels have no main-process handler, and `extension:get-log` is a `[]` stub. The dedicated-chat and live-log UI is dead in production while its tests pass against the mock (B-UIAPP-01).
3. The F5-09 fix to `WaveformPlayer` added a regression: `AudioMessage` passes a new `peaks` array on every render, so any row re-render destroys the player and stops playback (B-UIAPP-02). Separately, `useAIStream.executeToolCall` writes tool results and AI answers into whichever session is open when the tool returns (B-UIAPP-03). Its tool, retry and error paths have no tests.
4. `App.tsx` unmounts the whole `ChatLayout` whenever `wa-connected` fires after `ready` (a transient reconnect). The open chat, draft and AI stream are lost, and the state machine has no tests (B-UIAPP-04, R-UIAPP-08).
5. Modal handling uses 5 inconsistent patterns: two components are both named `ConfirmModal`, ExtensionManager and OverlayShell bypass BaseModal, and `window.confirm` is used. On top of that, types are duplicated between renderer and main with drift (`SearchFilters` dates, `ExecuteContributionOpts`, `ModalRequest`), and the Tailwind setup is dead. Consolidate via R-UIAPP-06, 09 and 10.
