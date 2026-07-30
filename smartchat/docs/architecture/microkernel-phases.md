# SmartChat — Microkernel Refactor: Phase Tracker

## HOW TO USE THIS FILE

**At the start of every session executing or reviewing this refactor:**
1. Read `docs/architecture/microkernel.md` fully — it is the ground truth architecture specification.
2. Read this phase tracker to review completed phase deliverables or identify the next active phase.
3. Observe strict TDD practices: test files must be created/executed first (RED) before implementing logic (GREEN).
4. Strictly enforce zero-`any` policy across SDK interfaces, kernel modules, context builders, and IPC layers.
5. Ensure all core boundaries strictly adhere to SOLID design principles (DIP, OCP, LSP).

**Status indicators:**
- ⏳ TODO — not started
- 🔄 IN PROGRESS — currently being worked on
- ✅ DONE — completion gate passed

**Core Governance & Rules:**
- **Ground Truth Spec**: Always refer to `docs/architecture/microkernel.md` for design principles, capability scopes, and contribution slots.
- **TDD Workflow**: Write and run unit/integration tests (RED) before implementing production code (GREEN).
- **Zero `any` Policy**: All DTO interfaces, SDK context calls, and module dispatchers must enforce strict TypeScript typing.
- **Native Module Rebuild Requirement**:
  > [!CAUTION]
  > Tests rebuild native modules for **Node.js**. The app (`npm run dev`) needs them built for **Electron**.
  > After running any tests, run `npm run test:rebuild:electron` before running `npm run dev`.

**Test commands reference:**
```bash
npm run test:run                     # rebuild for Node + run ALL tests
npm run test:run -- src/main/tests/kernel/api-modules/KernelMessagesModule.test.ts  # run single test file
npm run typecheck                    # runs both typecheck:node and typecheck:web
npm run test:rebuild:electron        # MUST run after tests, before npm run dev
```

---

## Phase 1 — Core Contracts & Registry ✅ DONE

### Goal
Build the pure foundation: contribution types, the contribution registry, permission store, and kernel module base contracts.

### Architecture & Implementation
- `ContributionPoints.ts`: Defined all core contribution point types and the extensible `ContributionMap` interface.
- `IContributionRegistry.ts` & `ContributionRegistry.ts`: Implemented `IContributionRegistry` storing contributions per slot in `Map<ContributionSlot, ContributionMap[K][]>`.
  - Automatically injects `pluginId` onto contribution descriptors during registration.
  - `unregisterAll(pluginId)` removes all contributions associated with a plugin across all slots.
  - Synchronous `onChange()` callback subscription mechanism notifying listeners on registration changes.
- `IPermissionStore.ts` & `PermissionStore.ts`: Implemented capability checking (`hasCapability`), allow/deny resource scope matching (`isResourceAllowed`), capability mutation, and persistent JSON backing store.
- `IKernelModule.ts`: Base interface for kernel API namespaces.

### Key Files & Artifacts
- [ContributionPoints.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/contributions/ContributionPoints.ts)
- [IContributionRegistry.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/contributions/IContributionRegistry.ts)
- [ContributionRegistry.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/contributions/ContributionRegistry.ts)
- [IPermissionStore.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/permissions/IPermissionStore.ts)
- [PermissionStore.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/permissions/PermissionStore.ts)
- [IKernelModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/IKernelModule.ts)

### Acceptance Criteria & Verification
- [x] `ContributionRegistry` unit tests pass with zero failures
- [x] `PermissionStore` capability and resource scoping unit tests pass
- [x] Pre-existing test suite regression check clean
- [x] Zero TypeScript typecheck errors

---

## Phase 2 — Plugin Channel Layer ✅ DONE

### Goal
Build the `IPluginChannel` abstraction, in-process and worker-thread channels, and `KernelAPIRouter`.

### Architecture & Implementation
- `IPluginChannel.ts`: Defined core request/response correlation protocols (`KernelRequest`, `KernelResponse`, `KernelErrorPayload`).
- `DirectPluginChannel.ts`: Built synchronous in-process channel for built-in plugins without worker thread overhead.
- `WorkerPluginChannel.ts`: Built isolated worker thread channel using Node.js `worker_threads` `MessagePort` pair for external plugins, managing request ID to Promise correlation maps and clean termination.
- `KernelAPIRouter.ts`: Implemented central routing engine matching request namespaces (`kernel:chats`, `kernel:messages`), invoking corresponding kernel modules, catching exceptions, and returning structured error payloads.

### Key Files & Artifacts
- [IPluginChannel.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/channels/IPluginChannel.ts)
- [DirectPluginChannel.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/channels/DirectPluginChannel.ts)
- [WorkerPluginChannel.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/channels/WorkerPluginChannel.ts)
- [KernelAPIRouter.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/KernelAPIRouter.ts)

### Acceptance Criteria & Verification
- [x] `DirectPluginChannel` in-process request/response delivery tests pass
- [x] `WorkerPluginChannel` message port correlation and destroy cleanup tests pass
- [x] `KernelAPIRouter` namespace routing and exception handling tests pass
- [x] Zero TypeScript typecheck errors

---

## Phase 3 — Plugin Host & Loader ✅ DONE

### Goal
Build the plugin lifecycle management system: `PluginHost` for active plugins, `PluginLoader` for `.scext` packaging, and `PluginRegistry` for metadata.

### Architecture & Implementation
- `PluginRegistry.ts`: Implemented in-memory store of loaded plugin metadata (`PluginMetadata`).
- `PluginLoader.ts`: Implemented `.scext` ZIP extraction, manifest v2 validation, worker thread spin-up, and directory management. Rejects legacy manifest v1 packages.
- `PluginHost.ts`: Implemented central host coordinating loader, registry, router, permission store, and contribution registry. Manages activation, deactivation, contribution cleanup, and built-in plugin registration.

### Key Files & Artifacts
- [PluginRegistry.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/plugins/PluginRegistry.ts)
- [PluginLoader.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/plugins/PluginLoader.ts)
- [PluginHost.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/plugins/PluginHost.ts)
- [PluginManifest.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/plugins/PluginManifest.ts)

### Acceptance Criteria & Verification
- [x] `PluginLoader` ZIP extraction and manifest v2 validation tests pass
- [x] `PluginHost` plugin activation, deactivation, and contribution cleanup tests pass
- [x] All 707 project tests pass cleanly

---

## Phase 4 — Kernel API Modules ✅ DONE

### Goal
Build permission-validated kernel API modules wrapping core domain services and exposing serializable interfaces to plugins.

### Architecture & Implementation
- Created 7 domain kernel API modules in `src/main/kernel/api-modules/`:
  - `KernelChatsModule.ts`: Wraps chat query and action services (chat list, get by JID, pin, mute, archive, mark read).
  - `KernelMessagesModule.ts`: Wraps message query, action, and media services (get messages, send, delete, react).
  - `KernelContactsModule.ts`: Wraps contact resolution services (get by JID).
  - `KernelAIModule.ts`: Wraps AI response generation and tool registry.
  - `KernelEventsModule.ts`: Bridges `IWAEventBus` events to plugin event subscriptions.
  - `KernelStorageModule.ts`: Wraps plugin key-value storage repository.
  - `KernelUIModule.ts`: Wraps native desktop notifications and toast messages.
- Enforced strict capability and resource scope checking on every module request.

### Key Files & Artifacts
- [KernelChatsModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelChatsModule.ts)
- [KernelMessagesModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelMessagesModule.ts)
- [KernelContactsModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelContactsModule.ts)
- [KernelAIModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelAIModule.ts)
- [KernelEventsModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelEventsModule.ts)
- [KernelStorageModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelStorageModule.ts)
- [KernelUIModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelUIModule.ts)

### Acceptance Criteria & Verification
- [x] Every API module has dedicated unit tests covering capability-denied and capability-granted cases
- [x] All return values verified to be JSON-serializable
- [x] Zero TypeScript errors

---

## Phase 5 — SDK Package ✅ DONE

### Goal
Build `packages/sdk/` — the `@smartchat/sdk` package and `WorkerPluginRuntime` running inside external plugin worker threads.

### Architecture & Implementation
- `packages/sdk/src/manifest.ts`: Created Zod schema for manifest v2 validation.
- `packages/sdk/src/context.ts`: Defined `PluginContext`, `IPluginChatsAPI`, `IPluginMessagesAPI`, `IPluginContactsAPI`, `IPluginAIAPI`, `IPluginEventsAPI`, `IPluginStorageAPI`, `IPluginUIAPI`.
- `packages/sdk/src/channel.ts`: Implemented `WorkerPluginRuntime` translating plugin API calls into worker `postMessage` requests and managing request correlation.
- `packages/sdk/src/cli/package.ts`: Built CLI packager (`smartchat-sdk package`) compiling plugin directories into valid `.scext` archives.

### Key Files & Artifacts
- [manifest.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/manifest.ts)
- [context.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/context.ts)
- [channel.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/channel.ts)

### Acceptance Criteria & Verification
- [x] `WorkerPluginRuntime` postMessage request translation tests pass
- [x] Manifest validation schema accepts v2 and rejects v1
- [x] SDK builds to standalone CommonJS package under `packages/sdk/dist/`

---

## Phase 6 — Built-in Plugins (Dogfooding) ✅ DONE

### Goal
Convert core internal capabilities into built-in microkernel plugins executing over `DirectPluginChannel`.

### Architecture & Implementation
- Built 4 in-process plugins under `src/main/plugins/builtin/`:
  - `WhatsappCorePlugin`: Contributes chat action menu items (pin, unpin, archive, unarchive, mute, unmute, mark read).
  - `AIAssistantPlugin`: Registers default AI tools (`send_message`, `get_recent_messages`, `search_contacts`) into the contribution system.
  - `SearchPlugin`: Contributes search sidebar panel entry points.
  - `NotificationsPlugin`: Contributes notification preferences settings pages.
- Each plugin exposes a valid `PluginManifest` v2 declaration.

### Key Files & Artifacts
- [WhatsappCorePlugin](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/plugins/builtin/whatsapp-core/index.ts)
- [AIAssistantPlugin](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/plugins/builtin/ai-assistant/index.ts)
- [SearchPlugin](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/plugins/builtin/search/index.ts)
- [NotificationsPlugin](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/plugins/builtin/notifications/index.ts)

### Acceptance Criteria & Verification
- [x] All built-in plugins activate cleanly via `PluginHost.registerBuiltin()`
- [x] Built-in contributions populate `ContributionRegistry` on startup
- [x] Unit test suites pass for all 4 built-in plugins

---

## Phase 7 — Renderer Context & Hooks ✅ DONE

### Goal
Expose the microkernel contribution snapshot to the React renderer and provide typed hooks and IPC execution handlers.

### Architecture & Implementation
- `contributionIpc.ts`: Main process IPC handlers for fetching snapshots (`kernel:contributions:snapshot`) and executing contributions (`kernel:contribution:execute`).
- Preload Bridge (`api.service.ts` & `IAPIService.ts`): Extended preload bridge with `getContributions`, `executeContribution`, and `onContributionsUpdated`.
- `ContributionContext.tsx`: React context provider receiving live contribution snapshot updates pushed from main process via IPC.
- `useContributions.ts`: Typed React hook (`useContributions<K>(slot)`) returning active contributions for a requested slot.

### Key Files & Artifacts
- [contributionIpc.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/ipc/contributionIpc.ts)
- [ContributionContext.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/context/ContributionContext.tsx)
- [useContributions.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/hooks/useContributions.ts)

### Acceptance Criteria & Verification
- [x] `ContributionContext` fetches initial snapshot and updates on IPC push events
- [x] `useContributions` hook returns typed contributions per slot
- [x] `executeContribution` IPC handler reaches plugin channel in main process

---

## Phase 8 — Bootstrap Wiring ✅ DONE

### Goal
Replace the legacy extension system in `src/main/index.ts` with `KernelBootstrapper`.

### Architecture & Implementation
- `KernelBootstrapper.ts`: Created central bootstrapper initializing PermissionStore, ContributionRegistry, API Modules, APIRouter, PluginLoader, and PluginHost.
- `src/main/index.ts`: Updated main process entry point to invoke `KernelBootstrapper.boot()`, wire contribution IPC handlers, and remove legacy extension imports.

### Key Files & Artifacts
- [KernelBootstrapper.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/KernelBootstrapper.ts)
- [index.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/index.ts)

### Acceptance Criteria & Verification
- [x] Bootstrap smoke test passes
- [x] Built-in plugin contributions appear in registry on boot
- [x] Legacy extension system imports completely removed from `index.ts`

---

## Phase 9 — UI Component Updates ✅ DONE

### Goal
Update React UI components to consume contributions dynamically via `useContributions()` hooks instead of static hardcoded lists.

### Architecture & Implementation
- `ChatList.tsx`: Dynamically renders chat context menu items from `useContributions('chat-action')` and dispatches execution via `api.executeContribution()`.
- `MessageItem.tsx`: Dynamically renders message context menu items from `useContributions('message-action')`.
- `MessageInput.tsx`: Intercepts slash commands starting with `/` from `useContributions('slash-command')`.

### Key Files & Artifacts
- [ChatList.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/components/chat/ChatList.tsx)
- [MessageItem.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/components/chat/MessageItem.tsx)
- [MessageInput.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/components/chat/MessageInput.tsx)

### Acceptance Criteria & Verification
- [x] Context menus dynamically render contributions for active plugins
- [x] Clicking context actions invokes `api.executeContribution()` correctly
- [x] Built-in actions (pin, mute, archive, mark read) operate seamlessly

---

## Phase 10 — Cleanup & E2E Testing ✅ DONE

### Goal
Delete legacy `src/main/extensions/` directory and write comprehensive end-to-end integration tests for dynamic external plugin loading.

### Architecture & Implementation
- `PrismaPluginStorageRepository.ts`: Built persistent key-value storage repository backing `KernelStorageModule`.
- `external-plugin.test.ts`: Created E2E integration test generating a `.scext` archive, loading it, executing contributions, and testing clean unloading.
- Complete deletion of `src/main/extensions/` with zero remaining import references.

### Key Files & Artifacts
- [external-plugin.test.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/tests/kernel/e2e/external-plugin.test.ts)
- [PrismaPluginStorageRepository.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/storage/PrismaPluginStorageRepository.ts)

### Acceptance Criteria & Verification
- [x] `src/main/extensions/` deleted with zero import references remaining
- [x] End-to-end external plugin loading test passes cleanly
- [x] 177 test files (749 tests) pass with zero failures

---

## Production Hardening & Integrations ✅ DONE

### Goal
Harden dynamic external `.scext` plugin loading, chatbar slash command execution, and multi-provider AI tool bridging.

### Architecture & Implementation
- Declarative Manifest Parsing: Updated `PluginHost.load()` to parse `manifest.contributions` and register all entries into `IContributionRegistry`.
- Dynamic Permission Store Registration: Automatically registers declared permissions in `PermissionStore` during dynamic installation.
- LLM AI Tool Bridging: Synced `IContributionRegistry` `'ai-tool'` entries into `services.toolRegistry`, allowing Gemini LLMs to auto-discover and execute external plugin tools.

### Key Files & Artifacts
- [contributionIpc.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/ipc/contributionIpc.ts)
- [PluginHost.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/plugins/PluginHost.ts)

### Acceptance Criteria & Verification
- [x] External `.scext` plugins auto-register contributions upon dynamic installation
- [x] Main chatbar intercepts slash commands and executes plugin code
- [x] Multi-provider AI chat service automatically discovers plugin AI tools

---

## External Plugin — Voice Transcriber ✅ DONE

### Goal
Implement a standalone external plugin (`com.smartchat.voice-transcriber`) contributing a `messageAction` ("Transcribe Audio") using FFmpeg audio decoding and `@xenova/transformers` Whisper AI speech recognition.

### Architecture & Implementation
- `kernel:messages:downloadMedia`: Microkernel API method downloading and caching WhatsApp voice note media on demand.
- `voice-transcriber.scext`: Packaged external plugin decoding Ogg Opus audio to 16kHz Float32 PCM and generating speech transcriptions.

---

## Declarative Condition Trees & Recursive Submenus ✅ DONE

### Goal
Replace hardcoded context menu action visibility logic with declarative Zod-validated `when` condition trees and support arbitrary recursive submenus with plugin-provided custom SVG & Lucide icons.

### Architecture & Implementation
- `WhenCondition`: Implemented structured JSON Condition Tree schema (`WhenLeaf`, `WhenCondition`) supporting `eq`, `neq`, `in`, `nin` operators combined with `and` / `or` logical blocks. Evaluated in renderer via `evaluateWhen()`.
- `SubMenuItemDeclaration`: Dedicated module `src/main/kernel/contributions/SubMenuItemDeclaration.ts` and Zod schema `SubMenuItemSchema` using `z.lazy()` supporting recursive submenus (`subMenu?: SubMenuItemDeclaration[]`).
- Manifest-Driven Icons & Lucide Support: `WhatsappCorePlugin` supplies SVG string constants directly in its manifest via `svgIcons.ts`. `PluginIcon.tsx` dynamically renders raw SVG strings, image URLs, or Lucide icon names (`"pin"`, `"bell-off"`, `"mic"`, `"zap"`, `"flask"`).
- Shared Submenu Transformer: Extracted `mapSubMenuItems` into `src/renderer/src/utils/contributionUtils.tsx` shared between `ChatList.tsx` and `MessageItem.tsx`.

### Key Files & Artifacts
- [WhenCondition.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/contributions/WhenCondition.ts)
- [SubMenuItemDeclaration.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/contributions/SubMenuItemDeclaration.ts)
- [PluginIcon.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/components/common/PluginIcon.tsx)
- [contributionUtils.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/utils/contributionUtils.tsx)
- [whenCondition.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/utils/whenCondition.ts)

### Acceptance Criteria & Verification
- [x] Context menus render declarative `when` condition filters
- [x] Submenus recursively nest to arbitrary depths
- [x] Raw SVG markup, image URLs, and Lucide icons render dynamically with zero hardcoded switch cases in components
- [x] All 97 test files (460 tests) pass with zero TypeScript errors

### Key Files & Artifacts
- `plugins/voice-transcriber-plugin/manifest.json`
- [KernelMessagesModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelMessagesModule.ts)

### Acceptance Criteria & Verification
- [x] Voice transcriber plugin packaged as standalone `.scext` archive
- [x] Microkernel automatically downloads uncached WhatsApp voice notes
- [x] FFmpeg converts audio to 16kHz mono Float32 PCM buffer for Whisper model

---

## SOLID Architecture & Quality Audit ✅ DONE

### Goal
Perform an architectural audit to enforce SOLID principles, extract shared module logic, introduce structured error hierarchies, and eliminate `any` types.

### Architecture & Implementation
- `BaseKernelModule.ts`: Abstract base class providing DRY permission validation (`requireCapability`, `requireResourceScope`) and object serialization.
- `KernelErrors.ts`: Structured error class hierarchy (`KernelError`, `KernelPermissionError`, `KernelNotFoundError`) preserving stack traces.
- SOLID Compliance:
  - **DIP**: `PluginHost` decoupled using `IPluginLoader`, `IPluginRegistry`, and `IKernelAPIRouter` abstractions.
  - **OCP**: Dynamic `incomingHandlers` in SDK worker runtime and dynamic slot enumerations.
  - **LSP**: Explicit `IBidirectionalPluginChannel` interface and type guard.

### Key Files & Artifacts
- [BaseKernelModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/BaseKernelModule.ts)
- [KernelErrors.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelErrors.ts)

### Acceptance Criteria & Verification
- [x] All 7 kernel API modules extend `BaseKernelModule`
- [x] Structured `KernelError` class hierarchy used for errors
- [x] Loose `any` casts removed across built-in plugin context wrappers

---

## Microkernel API Surface Expansion ✅ DONE

### Goal
Expand missing high-value domain capabilities across `kernel:messages`, `kernel:chats`, `kernel:contacts`, and `kernel:ai` modules, enforcing strict zero-`any` DTO typing.

### Architecture & Implementation
- `KernelMessagesModule`: Added `edit`, `forward`, `sendMedia`, `getMessagesAroundId`, `getReceipts`, `addFavoriteSticker`, `getFavoriteStickers`, `downloadMedia`.
- `KernelChatsModule`: Added `getGroupParticipants`.
- `KernelContactsModule`: Added `batchGetByJids`, `getMe`, `upsertContact`, `resolveLid`, `getAlias`.
- `KernelAIModule`: Added `getAvailableModels`, `createSession`, `listSessions`, `getSession`, `renameSession`, `deleteSession`.
- SDK & PluginHost Refactoring: Strongly-typed DTOs (`PluginReceiptItem`, `PluginGroupParticipant`, `PluginMeInfo`, `PluginAISession`) and generic `request<T>` dispatcher in `PluginHost.ts`.

### Key Files & Artifacts
- [KernelMessagesModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelMessagesModule.ts)
- [KernelChatsModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelChatsModule.ts)
- [KernelContactsModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelContactsModule.ts)
- [KernelAIModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelAIModule.ts)
- [context.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/context.ts)
- [PluginHost.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/plugins/PluginHost.ts)

### Acceptance Criteria & Verification
- [x] 20 new kernel API module actions implemented with capability and scope checks
- [x] All required services injected via `KernelBootstrapper.ts`
- [x] Zero `any` types in `@smartchat/sdk` context interfaces or `PluginHost.ts`
- [x] Unit test suites updated with 100% pass rate
- [x] Zero TypeScript errors (`npm run typecheck`)

---

## Phase 11a — Declarative Modal API ✅ DONE

### Goal
Implement `showForm`, `showConfirm`, and `showAlert` — host-rendered, zero-webview-lag Tier 1 overlay calls that collect user input using the app's own React design system.

### Architecture & Implementation
- `IOverlayHost` / `OverlayHost.ts`: Interface and concrete implementation bridging `KernelUIModule` to the renderer via `BrowserWindow.webContents`, with a pending-modal map keyed by `modalId` (UUID).
- `KernelUIModule`: Extended with `showForm`, `showConfirm`, `showAlert` actions under `kernel:ui` namespace. Capability check: `ui:notification`.
- SDK `context.ts`: `IPluginUIAPI` extended with all three methods + `OverlayFormSchema` / `OverlayFormField` types.
- SDK `channel.ts`: `WorkerPluginRuntime` wires `showForm`, `showConfirm`, `showAlert` to `kernel:ui:*` requests.
- Preload bridge: `onModalShow` (push from main) and `resolveModal` (renderer → main) exposed on `window.api`.
- `ModalPortal.tsx`: Root-mounted portal managing pending modal queue.
- `FormModal.tsx`, `ConfirmModal.tsx`, `AlertModal.tsx`: React components using `--wa-*` design tokens throughout.
- IPC handler: `kernel:ui:modal:resolve` routes renderer response back to `OverlayHost.resolveModal()`.

### Acceptance Criteria & Verification
- [x] `showForm`, `showConfirm`, `showAlert` available on `ctx.ui` in SDK
- [x] `FormModal` handles all 5 field types: `text`, `textarea`, `select`, `radio`, `checkbox`
- [x] Submit resolves with form values; dismiss/cancel resolves with `null` / `false`
- [x] All modal components use `--wa-*` tokens exclusively (zero hardcoded colors)
- [x] `IOverlayHost` interface maintained — `KernelUIModule` has no direct `electron` import
- [x] Zero TypeScript errors

---

## Phase 11b — Webview Overlay API ✅ DONE

### Goal
Implement `ctx.ui.showOverlay()` — Tier 2 overlay mechanism rendering custom plugin HTML inside a sandboxed Electron `<webview>` with bidirectional IPC event streaming and CSS design token injection.

### Architecture & Implementation
- `plugin://` Custom Protocol Handler ([pluginProtocol.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/protocol/pluginProtocol.ts)): Resolves plugin HTML assets from extracted `.scext` paths with strict path traversal isolation.
- Overlay Preload Script ([overlay-preload.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/preload/overlay-preload.ts)): Built artifact exposing `window.__smartchat` bridge (`submit`, `emit`, `dismiss`).
- SDK Integration ([context.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/context.ts), [channel.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/channel.ts), [overlay.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/overlay.ts)): Added `OverlayOptions` and `PluginOverlayHandle` types, `applyTokens()` CSS token injection helper, and wired Model A (Promise) / Model B (Handle) overloads.
- Domain Encapsulation ([IOverlayHost.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/ui/IOverlayHost.ts) & [OverlayHost.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/ui/OverlayHost.ts)): `OverlayHost` manages overlay UUID assignment, active overlay tracking (`OVERLAY_ALREADY_OPEN` error enforcement), and Promise/Handle resolution.
- `KernelUIModule`: High-level capability check (`ui:overlay`) delegating directly to `IOverlayHost.showOverlay()`.
- React Renderer UI ([OverlayShell.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/components/overlays/OverlayShell.tsx) & [ModalPortal.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/components/overlays/ModalPortal.tsx)): Host header shell with title and close button, sandboxed `<webview>`, `:root` CSS custom property serialization on `dom-ready`, and reverse IPC channel routing.

### Key Files & Artifacts
- [pluginProtocol.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/protocol/pluginProtocol.ts)
- [overlay-preload.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/preload/overlay-preload.ts)
- [OverlayShell.tsx](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/renderer/src/components/overlays/OverlayShell.tsx)
- [OverlayHost.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/ui/OverlayHost.ts)
- [KernelUIModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelUIModule.ts)

### Acceptance Criteria & Verification
- [x] `plugin://` protocol resolves `.scext` extracted files correctly with path traversal safety
- [x] `overlay-preload.js` compiled and referenced in `<webview>`
- [x] `window.__smartchat.submit/emit/dismiss` exposed in webviews
- [x] `smartchat:init` delivers `--wa-*` design tokens and context to overlay
- [x] Model A `showOverlay()` returns Promise resolving on submit and null on dismiss
- [x] Model B `showOverlay({ mode: 'handle' })` returns `PluginOverlayHandle` for live event streaming
- [x] `OVERLAY_ALREADY_OPEN` enforced (only one active overlay per plugin)
- [x] All 185 test files (822 tests) pass with zero errors
- [x] Zero TypeScript typecheck errors

---

## Future Phases (Not Scoped Yet)

- **Phase 11c — Panel UI** (`ui:panel` — webview-based panels for `sidebar-panel` and `settings-page` contributions. Builds on Phase 11b's webview infrastructure.)
- **Phase 12 — Completion Providers** (inline suggestions while typing, `@` modal from plugins)
- **Phase 13 — Message Send Pipeline** (plugin interceptors before send)
- **Phase 14 — Inter-plugin API** (plugin exposes and another imports an API)
- **Phase 15 — Permission UI** (Settings → Extensions → Permissions page)
- **Phase 16 — Chat Badge Computation** (live badge updates from plugins on chat list)

