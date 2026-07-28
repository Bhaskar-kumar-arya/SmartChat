# SmartChat — Microkernel Refactor: Phase Tracker

## HOW TO USE THIS FILE

**At the start of every session executing this refactor:**
1. Read `docs/architecture/microkernel.md` fully — it is the ground truth
2. Read this file to find the first phase that is not marked ✅ DONE
3. Read whatever codebase areas you need to understand the current state (see each phase's Context section)
4. Follow the TDD workflow: write tests first (RED), then implement (GREEN)
5. Mark tasks `[x]` as you complete them, and fill in the `### Notes` section for any deviations
6. Run the Phase Completion Gate before marking a phase done

**Status indicators:**
- ⏳ TODO — not started
- 🔄 IN PROGRESS — currently being worked on
- ✅ DONE — completion gate passed

**TDD rule (non-negotiable):**
Write the test file first. Run it — it must fail (RED). Then implement. Run again — it must pass (GREEN).
Never implement code before a test exists for it.

**Regression rule (non-negotiable):**
Pre-existing tests must pass at every phase boundary.
Run `npm run test:run` and verify zero failures in `milestone2`, `milestone3`, `services/`, and all other pre-existing test files before marking any phase done.

> [!CAUTION]
> **CRITICAL — REBUILD REQUIREMENT:**
> Tests rebuild native modules for **Node.js**. The app (`npm run dev`) needs them built for **Electron**.
> These are INCOMPATIBLE. After running any tests, you MUST run:
> ```
> npm run test:rebuild:electron
> ```
> ...before running `npm run dev` again, or the app will crash on native module load.
> Conversely, before running tests after `npm run dev`, run `npm run test:rebuild:node`
> (this is already included in `npm run test:run` automatically).

**Test commands reference** (from `package.json`):
```bash
npm run test:run                     # rebuild for Node + run ALL tests (use this at phase gates)
npm run test:run -- src/main/tests/kernel/contributions/ContributionRegistry.test.ts  # run a single file
npm run typecheck                    # runs both typecheck:node and typecheck:web
npm run test:rebuild:electron        # MUST run after tests, before npm run dev
```

---

## Phase 1 — Core Contracts & Registry ✅ DONE

### Goal
Build the pure foundation: contribution types, the contribution registry, and the permission store.
No plugin loading. No wiring into index.ts. Just the core contracts and their first implementations.

### Context — Understand Before Starting
Before writing a single line of code, deeply understand:
- The **existing extension system** — what it currently does and how it is currently wired. Explore `src/main/extensions/` thoroughly. This is what you are eventually replacing.
- The **existing test helpers** — how tests are written, what mock infrastructure exists. Read `src/main/tests/` including setup, helpers, and at least one milestone test to understand the testing patterns.
- The **spec interfaces** for this phase — read §2.4 (IPermissionStore), §2.5 (IContributionRegistry), and §5 (ContributionPoints) in `microkernel.md`.
- Read all relevant files. Do not limit yourself to the above — if something is unclear, explore further.

### What to Build

**1. `src/main/kernel/contributions/ContributionPoints.ts`**
All contribution point types and the `ContributionMap` interface.
Exact types defined in §5 of `microkernel.md`. Use `interface ContributionMap` (not `type`) for OCP.

**2. `src/main/kernel/contributions/IContributionRegistry.ts`**
The registry interface. Exact shape in §2.5 of `microkernel.md`.

**3. `src/main/kernel/contributions/ContributionRegistry.ts`**
Concrete implementation of `IContributionRegistry`.
- Stores contributions per slot in a `Map<ContributionSlot, ContributionMap[K][]>`
- `register()` injects `pluginId` onto the contribution object (the plugin itself never sets it)
- `unregisterAll(pluginId)` removes all contributions from that plugin across all slots
- `onChange()` returns an unsubscribe function; fires synchronously after any register/unregister

**4. `src/main/kernel/permissions/IPermissionStore.ts`**
The permission store interface. Exact shape in §2.4 of `microkernel.md`.

**5. `src/main/kernel/permissions/PermissionStore.ts`**
Concrete implementation backed by a JSON file in `userData`.
- `hasCapability()` — checks if the plugin declared this capability in its manifest AND it hasn't been toggled off
- `isResourceAllowed()` — evaluates allow/deny scope; returns `true` if no scope is configured (default-allow)
- `setCapability()` / `setScope()` — mutate and persist to file
- `getPluginPermissions()` — returns the full state for the settings UI

**6. `src/main/kernel/api-modules/IKernelModule.ts`**
The kernel module interface. Exact shape in §3 of `microkernel.md`.

### TDD

Write tests first. Test file locations:
- `src/main/tests/kernel/contributions/ContributionRegistry.test.ts`
- `src/main/tests/kernel/permissions/PermissionStore.test.ts`

**ContributionRegistry tests must cover:**
- Registering a contribution injects `pluginId` correctly
- `getAll()` returns only contributions for the requested slot
- `unregisterAll()` removes all contributions for a plugin across all slots
- `onChange()` fires after register and after unregisterAll
- `onChange()` unsubscribe function works correctly
- Registering the same contribution twice from the same plugin does not deduplicate (both appear)

**PermissionStore tests must cover:**
- Plugin with capability in manifest: `hasCapability()` returns true
- Plugin without capability in manifest: `hasCapability()` returns false
- `hasCapability()` returns false after `setCapability(false)`
- `isResourceAllowed()` returns true with no scope configured (default-allow)
- `isResourceAllowed()` returns true when resourceId is in allow list
- `isResourceAllowed()` returns false when resourceId is NOT in allow list (allow list present)
- `isResourceAllowed()` returns false when resourceId is in deny list
- `getPluginPermissions()` reflects persisted state after setCapability

### Acceptance Criteria
- [x] `ContributionRegistry` test: all cases pass
- [x] `PermissionStore` test: all cases pass
- [x] All pre-existing tests still pass
- [x] Zero TypeScript errors: `npx tsc --noEmit`
- [x] No imports from `src/main/services/` concrete classes (interfaces only)

### Phase Completion Gate
```bash
npx vitest run --project main
npx tsc --noEmit
```

### Notes
Phase 01 core contracts, contribution registry, permission store, and IKernelModule interface implemented along with unit test suites. All 15 tests pass and typecheck completes with zero errors.

---

## Phase 2 — Plugin Channel Layer ✅ DONE

### Goal
Build the `IPluginChannel` abstraction and both of its implementations: `DirectPluginChannel`
(for built-in plugins) and `WorkerPluginChannel` (for external plugins). Build `KernelAPIRouter`
which receives plugin messages and dispatches to kernel modules.

### Context — Understand Before Starting
Before coding, understand:
- How **Node.js worker threads and MessageChannel/MessagePort** work. If unfamiliar, read the Node.js docs mentally or look at the existing embedding worker in `src/main/workers/` — that worker is a good reference for how workers are spun up and how messages flow.
- The **existing whatsapp worker bridge** (`src/main/workers/bridge/`) — it solves similar serialization problems and is worth understanding before building WorkerPluginChannel.
- Phase 1 output: `IPluginChannel`, `IKernelModule` (you built these, review them).
- The **message protocol** in §7 of `microkernel.md` — request/response correlation by `id`.

### What to Build

**1. `src/main/kernel/channels/IPluginChannel.ts`**
The core channel interface. Exact types from §2.1 of `microkernel.md`:
`KernelRequest`, `KernelResponse`, `KernelErrorPayload`, `KernelErrorCode`, `IPluginChannel`.

**2. `src/main/kernel/channels/DirectPluginChannel.ts`**
In-process channel for built-in plugins. No worker threads, no serialization.
- `sendToPlugin()` — calls the registered plugin request handler synchronously (wrapped in Promise)
- `sendResponseToPlugin()` — calls the registered response handler directly
- `onPluginRequest()` — registers the handler that receives plugin → kernel calls
- `destroy()` — clears all handlers

**3. `src/main/kernel/channels/WorkerPluginChannel.ts`**
Worker thread channel for external plugins.
- Takes a `Worker` and a `MessagePort` pair in its constructor
- `sendToPlugin()` — posts to the worker's MessagePort
- `onPluginRequest()` — listens on the kernel-side MessagePort
- Handles the correlation of request `id` ↔ pending Promise resolution
- `destroy()` — terminates the worker, closes ports, rejects all pending requests

**4. `src/main/kernel/KernelAPIRouter.ts`**
Receives `KernelRequest` messages from any plugin channel and routes to the correct `IKernelModule`.
- Registers kernel modules by namespace (e.g. `'kernel:chats'` → `KernelChatsModule`)
- Parses `request.type` to extract namespace (the part before the second `:`)
- Calls `module.handle(pluginId, type, payload)`
- Sends `KernelResponse` back through the originating channel
- On any exception: sends `{ ok: false, error: { code: 'INTERNAL_ERROR', message: ... } }`

### TDD

Test file locations:
- `src/main/tests/kernel/channels/DirectPluginChannel.test.ts`
- `src/main/tests/kernel/channels/WorkerPluginChannel.test.ts`
- `src/main/tests/kernel/KernelAPIRouter.test.ts`

**DirectPluginChannel tests must cover:**
- `sendToPlugin()` delivers the message to the handler registered via `onPluginRequest()`
- `sendResponseToPlugin()` delivers the response to the plugin side
- `destroy()` prevents further message delivery
- Request/response correlation works: response `id` matches request `id`

**WorkerPluginChannel tests must cover:**
- Sending a request through the channel reaches the worker (use a simple test worker script)
- Response from worker resolves the correct pending Promise
- `destroy()` rejects all pending Promises with a clean error
- Non-serializable payloads throw at the send boundary (not silently corrupt)

**KernelAPIRouter tests must cover:**
- Routes request with type `'kernel:chats:getList'` to the module registered for `'kernel:chats'`
- Unknown namespace returns `{ ok: false, error: { code: 'NOT_FOUND' } }`
- Module exception is caught and returns `{ ok: false, error: { code: 'INTERNAL_ERROR' } }`
- Multiple modules registered: each routes independently

### Acceptance Criteria
- [x] `DirectPluginChannel` test: all cases pass
- [x] `WorkerPluginChannel` test: all cases pass
- [x] `KernelAPIRouter` test: all cases pass
- [x] All pre-existing tests still pass
- [x] Zero TypeScript errors

### Phase Completion Gate
```bash
npm run test:run
npm run typecheck
```
> After testing, run `npm run test:rebuild:electron` before `npm run dev`.

### Notes
Phase 02 completed: `IPluginChannel`, `DirectPluginChannel`, `WorkerPluginChannel`, and `KernelAPIRouter` implemented along with TDD unit test suites. All 15 phase 2 tests pass, all 30 kernel tests pass, and full project typecheck succeeds with zero errors.

---

## Phase 3 — Plugin Host & Loader ✅ DONE

### Goal
Build the plugin lifecycle system: `PluginHost` manages loaded plugins, `PluginLoader` handles
`.scext` file reading and worker spin-up, `PluginRegistry` tracks metadata.

### Context — Understand Before Starting
- Read the **existing ExtensionLoader and ExtensionHost** in `src/main/extensions/host/` — understand the current `.scext` loading pattern (zip extraction, manifest validation, `require()`). You are replacing these.
- Read the **existing manifest types** and understand what v1 looked like vs the new v2 shape in §4 of `microkernel.md`.
- Understand Phase 2 output: `IPluginChannel`, `WorkerPluginChannel`, `DirectPluginChannel`.
- Understand Phase 1 output: `IContributionRegistry`, `IPermissionStore`.
- Read any other files you find relevant. The existing extension system has details worth learning from.

### What to Build

**1. `src/main/kernel/plugins/IBuiltinPlugin.ts`**
Interface for built-in plugins. Shape in §2.3 of `microkernel.md`.

**2. `src/main/kernel/plugins/IPluginHost.ts`**
Interface for the host. Shape in §2.2 of `microkernel.md`.

**3. `src/main/kernel/plugins/PluginRegistry.ts`**
Simple in-memory store of `PluginMetadata` (id, manifest, channel, isBuiltin).
Provides `register()`, `unregister()`, `get()`, `listLoaded()`.

**4. `src/main/kernel/plugins/PluginLoader.ts`**
Handles external plugin loading from `.scext` files.
- `install(scextPath)` — unzips to `userData/extensions/<id>/`, validates manifest v2
- `uninstall(id)` — removes the directory
- `load(id)` — reads the manifest, spins up a Worker thread pointed at the plugin's entry file, creates a `WorkerPluginChannel` for it
- `reload(id)` — clears the worker's require cache (or terminates + respawns), reloads
- `listInstalled()` — scans `userData/extensions/` for valid manifest v2 directories
- **Rejects v1 manifests** (missing `contributions` key or `apiVersion !== '2'`)

**5. `src/main/kernel/plugins/PluginHost.ts`**
Implements `IPluginHost`. Coordinates loader, registry, router, and contribution registry.
- `load(id)` — uses `PluginLoader` to get a channel, registers it in `PluginRegistry`, sends `activate` message to plugin, subscribes to `onPluginRequest` via `KernelAPIRouter`
- `unload(id)` — sends `deactivate` message, calls `IContributionRegistry.unregisterAll(id)`, calls `channel.destroy()`, removes from registry
- `registerBuiltin(plugin)` — creates a `DirectPluginChannel`, calls `plugin.activate(ctx)` where `ctx` is built from the channel
- `loadAll()` — calls `PluginLoader.listInstalled()` and loads each

### TDD

Test file location:
- `src/main/tests/kernel/plugins/PluginHost.test.ts`
- `src/main/tests/kernel/plugins/PluginLoader.test.ts`

**PluginHost tests must cover:**
- `registerBuiltin()` calls the plugin's `activate()` with a valid `PluginContext`
- After `registerBuiltin()`, the plugin appears in `listLoaded()`
- `unload()` removes the plugin from `listLoaded()`
- `unload()` calls `IContributionRegistry.unregisterAll()` with the correct pluginId
- `load()` is idempotent (calling twice doesn't load twice)

**PluginLoader tests must cover:**
- `install()` with a valid `.scext` succeeds and creates the directory
- `install()` with a v1 manifest (no `contributions` key) throws a validation error
- `listInstalled()` returns manifests from valid directories
- `listInstalled()` skips directories with invalid manifests (no throw)

### Acceptance Criteria
- [x] `PluginHost` test: all cases pass
- [x] `PluginLoader` test: all cases pass
- [x] All pre-existing tests still pass
- [x] Zero TypeScript errors
- [x] `PluginHost` depends only on interfaces (no concrete service imports)

### Phase Completion Gate
```bash
npm run test:run
npm run typecheck
```
> After testing, run `npm run test:rebuild:electron` before `npm run dev`.

### Notes
Phase 03 plugin lifecycle system implemented: `PluginManifest`, `PluginContext`, `IBuiltinPlugin`, `IPluginHost`, `PluginRegistry`, `PluginLoader`, and `PluginHost` with complete TDD test coverage in `PluginLoader.test.ts` and `PluginHost.test.ts`. All 707 project tests pass and full typecheck succeeds with zero errors.

---

## Phase 4 — Kernel API Modules ✅ DONE

### Goal
Build the kernel API modules that wrap the existing service layer and expose it to plugins through
permission-validated, serializable calls. This is the "meat" of the kernel.

### Context — Understand Before Starting
- Read `src/main/ServiceContainer.ts` in full — understand every service that is wired and what interface it exposes. This is the complete map of what the kernel modules will wrap.
- For each domain you're wrapping, read the relevant `I*.ts` service interfaces inside `src/main/services/`. Understand what methods exist and what they return.
- Read the **existing IPC handlers** in `src/main/ipcHandlers.ts` — many of them do the same thing you're building (validate → call service → serialize result). Use them as a reference for what needs to be serializable.
- Read `IPermissionStore` (Phase 1) and `IKernelModule` (Phase 2) — your modules implement these.
- Read §3 and §3.1 of `microkernel.md` for the namespace table and handling pattern.
- The plugin-side API shapes in §6 of `microkernel.md` tell you what the modules must support.

### What to Build

One file per module. All live in `src/main/kernel/api-modules/`.

**General pattern for every module:**
```typescript
class KernelXxxModule implements IKernelModule {
  readonly namespace = 'kernel:xxx'

  constructor(
    private readonly permissions: IPermissionStore,
    private readonly xxxService: IXxxService  // discovered by reading ServiceContainer
  ) {}

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    // 1. Parse action from type: 'kernel:xxx:doThing' → 'doThing'
    // 2. Match action → validate permission → call service → return serializable result
    // 3. Unknown action: throw with code 'NOT_FOUND'
  }
}
```

**Modules to build** (discover the exact service interfaces by reading the codebase):
- `KernelChatsModule` — wraps chat-related services (get list, get by jid, pin, unpin, archive, mute, mark read)
- `KernelMessagesModule` — wraps message-related services (get messages, send, delete, react)
- `KernelContactsModule` — wraps contact services (get by jid)
- `KernelAIModule` — wraps AI service and tool registry (chat, callTool, registerTool)
- `KernelEventsModule` — bridges `IWAEventBus` events to plugin event subscriptions
- `KernelStorageModule` — wraps the extension storage repository
- `KernelUIModule` — wraps notification service + BrowserWindow (notify, toast)

**Important:** Return values must be JSON-serializable. Read existing IPC handlers to see how services are currently serialized for the renderer — use the same patterns.

### TDD

Test files in `src/main/tests/kernel/api-modules/`.

Write at least one test file per module. For each module, cover:
- Permission denied: `hasCapability() = false` → returns `{ ok: false, error: { code: 'PERMISSION_DENIED' } }`
- Permission granted: correct method on the underlying service is called with correct args
- Unknown action type: returns `{ ok: false, error: { code: 'NOT_FOUND' } }`
- Service method returns non-serializable data: module strips it to plain objects before returning

Use `vi.fn()` mocks for the service interfaces — never use a real DB in these tests.
Use `getPrismaClient()` and real services only if testing end-to-end serialization matters.

### Acceptance Criteria
- [x] Every module has at least one test file with permission-denied + permission-granted cases
- [x] All module tests pass
- [x] All pre-existing tests still pass
- [x] Zero TypeScript errors
- [x] No module imports a concrete service class (interfaces only — enforced by §10 rule 1)
- [x] All module `handle()` return values pass `JSON.parse(JSON.stringify(x))` without data loss

### Phase Completion Gate
```bash
npm run test:run
npm run typecheck
```
> After testing, run `npm run test:rebuild:electron` before `npm run dev`.

### Notes
Phase 04 kernel API modules implemented: `KernelChatsModule`, `KernelMessagesModule`, `KernelContactsModule`, `KernelAIModule`, `KernelEventsModule`, `KernelStorageModule`, and `KernelUIModule` with individual unit test suites for each module under `src/main/tests/kernel/api-modules/`. All 42 module tests and all 749 project-wide Vitest tests pass cleanly. `npm run typecheck` completes with zero TypeScript errors.

---

## Phase 5 — SDK Package ✅ DONE

### Goal
Build `packages/sdk/` — the `@smartchat/sdk` package that external plugin authors use.
Specifically the `WorkerPluginRuntime`: the in-worker implementation of `PluginContext` that
translates API calls into `postMessage` calls to the kernel.

### Context — Understand Before Starting
- Read §6 of `microkernel.md` — the full `PluginContext` interface shape. This is what the runtime must implement.
- Understand `WorkerPluginChannel` (Phase 2) — specifically the message protocol it expects. The runtime is the other end of that channel.
- Understand §7 of `microkernel.md` — the request/response protocol. The runtime sends `KernelRequest` and awaits `KernelResponse`.
- Look at how Node.js `worker_threads` exposes `parentPort` — that's what the runtime posts messages through.
- Read the existing `src/main/workers/bridge/` for a real example of a worker-side message handler.
- Explore what a minimal viable SDK looks like for a plugin author. Think like the plugin author.

### What to Build

**`packages/sdk/src/manifest.ts`**
Copy the `PluginManifest` type from §4 of `microkernel.md` plus a zod-based validator:
```typescript
export function validateManifest(raw: unknown): PluginManifest  // throws on invalid
```

**`packages/sdk/src/contributions.ts`**
Re-export all contribution point types from `ContributionPoints.ts` (copy, not import — SDK is standalone).

**`packages/sdk/src/events.ts`**
`PluginEventMap` type — mirrors `ExtensionEventMap` from the existing system (read it to discover event shapes).

**`packages/sdk/src/channel.ts`** — `WorkerPluginRuntime`
The core of the SDK. This runs inside the plugin's worker thread.
- Uses `parentPort.on('message')` to receive `KernelRequest` (kernel → plugin direction) and `KernelResponse` (kernel answering plugin requests)
- Implements `PluginContext` by translating each API call into a `postMessage({ type: 'kernel:xxx:action', payload })` and returning a Promise that resolves when the matching `KernelResponse` arrives
- Manages a `Map<id, { resolve, reject }>` for pending request correlation
- Provides `ctx.contributions.registerChatAction(id, handler)` — stores the handler locally, and when the kernel sends `contribution:execute:chat-action`, calls it
- `ctx.log.*` writes to `parentPort` with type `'kernel:log'`

**`packages/sdk/src/index.ts`**
Barrel export.

**`packages/sdk/package.json`**
Standalone package. Peer dependency: none. Dependencies: `zod` for manifest validation.

### TDD

Test file: `packages/sdk/tests/WorkerPluginRuntime.test.ts`

The worker runtime is hard to test in an actual worker. Use a test harness that creates a fake MessagePort pair using Node's `MessageChannel`:

```typescript
const { port1, port2 } = new MessageChannel()
const runtime = new WorkerPluginRuntime(port1)
// port2 simulates the kernel
```

Tests must cover:
- Calling `ctx.chats.getList()` sends a correctly formatted `KernelRequest` via `port1`
- A `KernelResponse` arriving on `port1` resolves the pending Promise
- A `KernelResponse` with `ok: false` rejects the Promise with the error
- Kernel sending `contribution:execute:chat-action` calls the registered handler
- `ctx.log.info()` posts a log message through the port
- Timed-out requests reject after a reasonable deadline

### Acceptance Criteria
- [x] `WorkerPluginRuntime` test: all cases pass
- [x] `validateManifest()` accepts a valid v2 manifest
- [x] `validateManifest()` throws on a v1 manifest (missing `contributions`)
- [x] All pre-existing app tests still pass (SDK is a separate package, should not affect main)
- [x] Zero TypeScript errors in both `smartchat/` and `packages/sdk/`

### Phase Completion Gate
```bash
npm run test:run
npm run typecheck
# Also run SDK tests if vitest is configured for packages/sdk/
```
> After testing, run `npm run test:rebuild:electron` before `npm run dev`.

### Notes
Phase 05 SDK Package implemented: `@smartchat/sdk` created in `packages/sdk/` with `manifest.ts`, `contributions.ts`, `events.ts`, `context.ts`, `channel.ts` (`WorkerPluginRuntime`), and barrel `index.ts`. Compiled `@smartchat/sdk` to CommonJS (`dist/`), refactored external plugins (`test-all-features-plugin` and `voice-transcriber-plugin`) to consume `WorkerPluginRuntime`, and added built-in CLI packaging tool (`smartchat-sdk package` via `packages/sdk/src/cli/package.ts`). Comprehensive TDD unit test suites in `packages/sdk/tests/manifest.test.ts` and `WorkerPluginRuntime.test.ts`. All 108 test files (456 tests) pass cleanly across `main` and `sdk` projects, and `npm run typecheck` succeeds with zero errors.

---

## Phase 6 — Built-in Plugins (Dogfooding) ✅ DONE

### Goal
Convert internal features (chat actions, AI tools, search panel, notification settings) into
built-in plugins that use `DirectPluginChannel`. They register contributions exactly like external
plugins would. This is the "dogfooding" phase.

### Context — Understand Before Starting
- Read the **current IPC handlers** in `src/main/ipcHandlers.ts` — identify which handlers correspond to chat actions (pin, mute, archive, mark-read) and which to AI. These are what become built-in plugin handlers.
- Read the **current extension capability providers** in `src/main/extensions/capabilities/providers/` — understand what they currently expose. Some of that logic moves into built-in plugins.
- Read the **existing tool files** in `src/main/tools/` — understand what AI tools exist. The `ai-assistant` plugin will re-register these via `ctx.contributions.registerAITool()`.
- Understand `IBuiltinPlugin` (Phase 3) and `PluginContext` (Phase 5 SDK or its kernel-side equivalent via DirectPluginChannel).
- Read §1.4 of `microkernel.md` — built-ins use `DirectPluginChannel`, no workers.
- Explore the notification and search services to understand what the `search` and `notifications` plugins should expose.
- Read all relevant files. These plugins are replacing hard-wired behaviour — understand it completely before replacing it.

### What to Build

**`src/main/plugins/builtin/whatsapp-core/index.ts`**
Implements `IBuiltinPlugin`. On `activate(ctx)`:
- `ctx.contributions.registerChatAction('pin', handler)` — handler calls `ctx.chats.pin(ctx)`
- Same for `unpin`, `archive`, `unarchive`, `mute`, `unmute`, `mark-read`
- Reads the full list of what actions should be registered by inspecting the current UI and IPC handlers

**`src/main/plugins/builtin/ai-assistant/index.ts`**
Implements `IBuiltinPlugin`. On `activate(ctx)`:
- Reads the existing tool files in `src/main/tools/` and re-registers each via `ctx.contributions.registerAITool()`
- Note: the tools themselves are not moved — the plugin just wires them into the contribution system

**`src/main/plugins/builtin/search/index.ts`**
Implements `IBuiltinPlugin`. On `activate(ctx)`:
- Registers a `sidebar-panel` contribution for the search panel

**`src/main/plugins/builtin/notifications/index.ts`**
Implements `IBuiltinPlugin`. On `activate(ctx)`:
- Registers a `settings-page` contribution for notification preferences

Each built-in's manifest (`manifest` property on the class) must be a valid `PluginManifest` v2
with `apiVersion: '2'` and appropriate `permissions` and `contributions` declarations.

### TDD

Test files in `src/main/tests/kernel/plugins/builtin/`.

For each built-in plugin:
- Create a mock `PluginContext` using `vi.fn()` for all APIs
- Call `plugin.activate(mockCtx)`
- Assert that the expected `registerChatAction` / `registerAITool` / etc. calls were made with correct IDs
- Call `plugin.deactivate()` and assert cleanup

### Acceptance Criteria
- [x] Each built-in plugin test passes
- [x] `PluginHost.registerBuiltin()` successfully loads all four built-ins in isolation
- [x] Contributions from built-ins appear in `IContributionRegistry.getAll()` after activation
- [x] All pre-existing tests still pass
- [x] Zero TypeScript errors

### Phase Completion Gate
```bash
npm run test:run
npm run typecheck
```
> After testing, run `npm run test:rebuild:electron` before `npm run dev`.

### Notes
Phase 06 built-in plugins implemented: `WhatsappCorePlugin`, `AIAssistantPlugin`, `SearchPlugin`, and `NotificationsPlugin` created under `src/main/plugins/builtin/`. `PluginContext` and `PluginHost` updated to wire built-in contribution calls to `ContributionRegistry`. Unit test suites and integration tests added in `src/main/tests/kernel/plugins/builtin/`. All unit & integration tests and project typecheck pass with zero errors.

---

## Phase 7 — Renderer: ContributionContext ✅ DONE

### Goal
Make the React renderer contribution-aware. Build the context that holds the registry snapshot,
the hook to read it, and the IPC plumbing to push updates from kernel → renderer and
execute contributions from renderer → kernel.

### Context — Understand Before Starting
- Read the **current renderer structure** — explore `src/renderer/src/` thoroughly. Understand `APIContext.tsx`, `IAPIService.ts`, and `api.service.ts` (the preload bridge). This is how the renderer currently talks to the main process.
- Read the **current preload** in `src/preload/` — understand how `contextBridge` exposes APIs to the renderer.
- Understand how the **current extension IPC** works (`src/main/extensions/ipc.ts` and the renderer's extension hooks) — you are replacing part of this.
- Read §8 of `microkernel.md` — the `ContributionContext`, `useContributions` hook, and `executeContribution` IPC design.
- Explore the renderer's existing React context patterns to ensure the new context follows established conventions.
- Read all relevant files needed to understand the renderer ↔ main IPC pattern completely.

### What to Build

**Main process: New IPC handlers (add to existing IPC setup)**
- `kernel:contributions:snapshot` → returns the current full registry snapshot (all slots)
- `kernel:contribution:execute` → receives `{ slot, pluginId, id, context }`, routes to the plugin's channel
- `kernel:contributions:subscribe` → main process pushes a new snapshot to renderer via `webContents.send('kernel:contributions:updated', snapshot)` whenever `ContributionRegistry.onChange()` fires

**Preload: Extend `IAPIService`**
Add to `IAPIService.ts` and `api.service.ts`:
```typescript
getContributions(): Promise<ContributionRegistrySnapshot>
executeContribution(opts: ExecuteContributionOpts): Promise<void>
onContributionsUpdated(cb: (snapshot: ContributionRegistrySnapshot) => void): () => void
```

**`src/renderer/src/context/ContributionContext.tsx`**
- Fetches the snapshot on mount via `api.getContributions()`
- Subscribes to `api.onContributionsUpdated()` to stay live
- Provides the snapshot via React context

**`src/renderer/src/hooks/useContributions.ts`**
```typescript
function useContributions<K extends ContributionSlot>(slot: K): ContributionMap[K][]
```
Reads from `ContributionContext`.

### TDD

Test file: `src/renderer/tests/context/ContributionContext.test.tsx`

Tests must cover:
- Initial snapshot is fetched and provided via context
- When `onContributionsUpdated` fires, context re-renders with new snapshot
- `useContributions('chat-action')` returns only chat-action contributions
- `useContributions` with an empty slot returns `[]`

Use the renderer's existing test setup (jsdom, `@testing-library/react`).

### Acceptance Criteria
- [x] `ContributionContext` test: all cases pass
- [x] `useContributions` returns typed contributions correctly
- [x] `executeContribution` IPC handler reaches the correct plugin channel in main process
- [x] All pre-existing tests still pass (both `--project main` and `--project renderer`)
- [x] Zero TypeScript errors

### Phase Completion Gate
```bash
npm run test:run          # runs both main + renderer projects
npm run typecheck
```
> After testing, run `npm run test:rebuild:electron` before `npm run dev`.

### Notes
Phase 07 renderer contribution system implemented: `registerContributionIpcHandlers` created in main kernel (`src/main/kernel/ipc/contributionIpc.ts`), preload bridge & `IAPIService` updated with `getContributions`, `executeContribution`, and `onContributionsUpdated`, `ContributionProvider` built in `src/renderer/src/context/ContributionContext.tsx`, and typed `useContributions` hook built in `src/renderer/src/hooks/useContributions.ts`. Unit tests created in `src/renderer/tests/context/ContributionContext.test.tsx` and `src/main/tests/kernel/ipc/contributionIpc.test.ts`. All unit tests, full test suite, and typecheck pass with zero errors.

---


## Phase 8 — Bootstrap Wiring ✅ DONE

### Goal
Wire everything together in `index.ts`. Build `KernelBootstrapper` to replace the current extension
system bootstrapping. The app must boot end-to-end with built-in plugins loaded and the
contribution registry populated. The old `src/main/extensions/` code is retired here.

### Context — Understand Before Starting
- Read `src/main/index.ts` in full — understand the entire current bootstrap sequence, particularly the extension system wiring (the large block starting around the "Extension System Bootstrap" comment).
- Read `src/main/ServiceContainer.ts` — understand what services are available to wire into kernel modules.
- Understand all phases 1–7 output: what each class is, how it's constructed, what it needs.
- Understand the current `src/main/extensions/ipc.ts` — these IPC handlers are being replaced by Phase 7's new handlers.
- Read any other files referenced by `index.ts` that you need to understand completely.

### What to Build

**`src/main/kernel/KernelBootstrapper.ts`**
A class (or factory function) that takes `ServiceContainer`, the `BrowserWindow` getter, and the event bus getter, and wires up the complete kernel:
1. Creates `PermissionStore`
2. Creates `ContributionRegistry`, subscribes `onChange` to push snapshot via IPC
3. Creates all `IKernelModule` implementations, passing the appropriate services
4. Creates `KernelAPIRouter`, registers all modules
5. Creates `PluginLoader` (pointed at `userData/extensions/`)
6. Creates `PluginHost`, wires in loader, router, registry, permission store
7. Creates and registers all built-in plugins via `host.registerBuiltin()`
8. Calls `host.loadAll()` to load installed external plugins
9. Returns a disposable: `{ host, registry, dispose() }`

**`src/main/index.ts` — update bootstrap block**
- Replace the current extension system bootstrap block with `KernelBootstrapper`
- Keep everything else unchanged (WA connection, IPC handlers, window creation)
- Remove imports from `src/main/extensions/` (the old system)
- Wire up the new Phase 7 IPC handlers (contributions snapshot, execute, subscribe)

**Retire `src/main/extensions/`**
Once `index.ts` no longer imports from it, the old extension system can be deleted.
**Do not delete it in this phase** — only stop importing it. Deletion is a cleanup step
in Phase 9 to avoid accidentally breaking something.

### TDD

This phase is integration-level. Write a smoke test:
`src/main/tests/kernel/bootstrap.test.ts`

- Create a `KernelBootstrapper` with mocked services (use existing test helpers to get a `ServiceContainer`)
- Call `bootstrapper.boot()`
- Assert: `registry.getAll('chat-action')` contains the whatsapp-core built-in actions
- Assert: `host.listLoaded()` includes the four built-in plugin IDs
- Assert: `host.listLoaded()` does NOT include any external plugins (clean test environment)

### Acceptance Criteria
- [x] Bootstrap smoke test passes
- [x] App boots without errors (manual verification: run `npm run dev`, app opens)
- [x] Built-in plugin contributions appear in the contribution registry on boot
- [x] `src/main/extensions/` is no longer imported by `index.ts`
- [x] All pre-existing tests still pass
- [x] Zero TypeScript errors

### Phase Completion Gate
```bash
npm run test:run
npm run typecheck
# Manual: npm run test:rebuild:electron && npm run dev → app should open normally
```

### Notes
Phase 08 bootstrap wiring completed: `KernelBootstrapper` implemented in `src/main/kernel/KernelBootstrapper.ts`, `src/main/index.ts` updated to bootstrap the microkernel and wire contribution IPC handlers while removing old extension system imports. Integration smoke test created in `src/main/tests/kernel/bootstrap.test.ts`. All 55 test suites (379 tests) and full project typecheck pass with zero errors.

---

## Phase 9 — UI Component Updates ✅ DONE

### Goal
Update React components to read contributions from `useContributions()` instead of hardcoded
values. The first contribution slots to wire up: chat-action, message-action, chat-badge.
This makes the contribution system visibly functional in the UI.

### Context — Understand Before Starting
- Explore `src/renderer/src/components/` thoroughly. Find every component that renders:
  - Chat actions (the right-click / long-press menu on chat list items)
  - Message context menus / actions
  - Any hardcoded badge-like UI on chat rows
- Read the Phase 7 output: `useContributions` hook and `ContributionContext`
- Read `IAPIService.ts` — confirm `executeContribution` is available
- Understand the current UX for chat actions (pin, mute etc.) so you don't accidentally remove them — they're now coming from the `whatsapp-core` built-in plugin's contributions
- Explore the test files for components you're modifying to understand the existing test patterns
- Read all relevant files before touching anything

### What to Build
No new files needed — this phase modifies existing React components.

For each component discovered during exploration:
- Replace hardcoded action list with `useContributions('chat-action')` (or relevant slot)
- Replace hardcoded handler calls with `api.executeContribution({ slot, pluginId, id, context })`
- Ensure the UI still works identically for built-in actions (pin, mute, archive, mark-read)

**After the core slots are wired:**
- Add `useContributions('chat-badge')` to chat list row rendering
- Add an empty slot for `useContributions('sidebar-panel')` in the sidebar (no UI yet, just the hook)

### TDD

For each modified component, add or update renderer tests:
- Snapshot test: renders built-in contributions correctly
- Interaction test: clicking a contribution item calls `executeContribution` with correct args
- Empty state: no contributions renders nothing extra (no ghost buttons)

### Acceptance Criteria
- [x] Chat actions in the UI come from the contribution registry (not hardcoded)
- [x] Pin, mute, archive, mark-read still work (coming from whatsapp-core built-in)
- [x] All renderer tests pass
- [x] All main process tests still pass
- [x] Zero TypeScript errors
- [x] Manual verification: chat actions visible and functional in `npm run dev`

### Phase Completion Gate
```bash
npm run test:run
npm run typecheck
# Manual: npm run test:rebuild:electron && npm run dev
#         → right-click a chat → see pin/mute/archive/mark-read from built-in plugin
```

### Notes
Phase 09 UI component updates completed: `ChatList.tsx` and `MessageItem.tsx` updated to consume `useContributions()` for `chat-action`, `message-action`, `chat-badge`, and `sidebar-panel` slots. Context menus dynamically render registered contributions and dispatch execution via `api.executeContribution()`. Unit test suites added in `ChatListContributions.test.tsx` and `MessageItemContributions.test.tsx`.

---

## Phase 10 — Cleanup & External Plugin End-to-End ✅ DONE

### Goal
Delete the old `src/main/extensions/` directory (now fully replaced). Write an end-to-end test
with a real minimal external plugin loaded via `WorkerPluginChannel`. Verify the complete flow
from plugin install → load → contribution registration → UI display → user action → plugin handler.

### Context — Understand Before Starting
- Review all previous phase outputs to ensure nothing still imports from `src/main/extensions/`
- Understand what a minimal valid `.scext` plugin looks like (manifest v2 + simple JS entry)
- Read `src/main/tests/` to see if there are existing integration test patterns that can guide you
- Explore the test helpers for creating test `.scext` files programmatically

### What to Build

**Delete `src/main/extensions/`**
Only after confirming zero imports remain anywhere in `src/`.

**End-to-end test: `src/main/tests/kernel/e2e/external-plugin.test.ts`**
- Programmatically create a minimal `.scext` zip (a `manifest.json` + `index.js` that registers one chat action)
- Call `PluginHost.load(id)`
- Assert the plugin appears in `listLoaded()`
- Assert `registry.getAll('chat-action')` contains the plugin's contribution
- Simulate `executeContribution` → assert the plugin's handler was called
- Call `PluginHost.unload(id)` → assert contributions removed, plugin gone from `listLoaded()`

### Acceptance Criteria
- [x] `src/main/extensions/` deleted with no import references remaining
- [x] End-to-end external plugin test passes
- [x] All pre-existing tests still pass
- [x] Zero TypeScript errors
- [x] `npm run dev` — app boots, built-in plugins work, ready for external plugin install

### Phase Completion Gate
```bash
npm run test:run
npm run typecheck
# Check no remaining imports from the old extension system:
Select-String -Path "src\main\**\*.ts" -Pattern "from.*extensions/" -Recurse  # PowerShell
# (or grep -r "from.*extensions/" src/main/ on Unix)
# Must return zero results
``` 
> After testing, run `npm run test:rebuild:electron` before `npm run dev`.

### Notes
Phase 10 cleanup & E2E completed: Moved plugin storage persistence to `PrismaPluginStorageRepository` under `src/main/kernel/storage/`. Retired and deleted old `src/main/extensions/` directory and old extension test suite with zero remaining imports. Implemented end-to-end external plugin lifecycle test in `src/main/tests/kernel/e2e/external-plugin.test.ts`. Retired old doc generation script and removed doc copy buttons. Wired plugin lifecycle IPC handlers (`extension:list`, `extension:install`, `extension:unload`, `extension:reload`, `extension:uninstall`) to `PluginHost` and `PluginLoader`. All 177 test files (749 tests) pass cleanly and `npm run typecheck` succeeds with zero errors.

---

## Post Phase 10 — Production Hardening & Integration Polish ✅ DONE

### Goal
Harden the microkernel architecture for end-to-end production use in the application, ensuring external `.scext` plugins loaded dynamically at runtime have full declarative contribution registration, dynamic capability registration, UI rendering, slash-command chatbar interception, and LLM tool bridging.

### What Was Built & Fixed

1. **Declarative Contribution Parsing in `PluginHost.load()`**
   - Added automatic parsing of `manifest.contributions` during `PluginHost.load()` for external non-builtin plugins.
   - Automatically registers all manifest contributions (`chatActions`, `messageActions`, `chatBadges`, `slashCommands`, `keyboardShortcuts`, `statusBarItems`, `chatFilters`, `chatSortStrategies`, `sidebarPanels`, `settingsPages`, `aiTools`) directly into `IContributionRegistry`.

2. **Dynamic Permission Registration on Package Install**
   - Added `registerPluginManifest(pluginId, capabilities)` to `IPermissionStore` and `PermissionStore`.
   - Updated dynamic `.scext` package installation handler in `contributionIpc.ts` (`extensionInstallHandler`) to automatically register manifest permissions in `PermissionStore` prior to worker thread activation.

3. **Renderer React Context Wiring**
   - Wrapped `<App />` with `<ContributionProvider>` in `src/renderer/src/main.tsx` so the entire React tree receives live snapshot updates from `kernel:contributions:updated` via `useContributions()`.

4. **Chatbar Slash Command Interception**
   - Connected `useContributions('slash-command')` inside `src/renderer/src/components/chat/MessageInput.tsx`.
   - Automatically intercepts inputs starting with `/` (e.g. `/test-cmd`), clears the chat bar, and dispatches execution to `kernel:contribution:execute` for the matching plugin.

5. **LLM AI Tools Bridge**
   - Implemented dynamic bridging in `src/main/kernel/ipc/contributionIpc.ts` syncing `IContributionRegistry` `'ai-tool'` contributions directly into `services.toolRegistry`.
   - Enables Gemini / LLM multi-provider AI chat service (`AIService`) to automatically discover, document, and execute plugin-provided AI tools (e.g., `test_plugin_tool`).

6. **All-Features External Plugin Upgrades & E2E Validation**
   - Enhanced `plugins/test-all-features-plugin/index.js` to inspect real contact names via `kernel:contacts:getByJid`, query up to 50 recent messages dynamically, trigger native OS desktop notifications via `kernel:ui:notify`, send automated WhatsApp replies (`"test working"`) via `kernel:messages:send`, and apply `✨` reactions via `kernel:messages:react`.

### Acceptance Criteria
- [x] External `.scext` plugins installed dynamically register contributions and permissions without errors
- [x] Renderer React components dynamically update when contributions change
- [x] Slash commands typed in the main chatbar execute plugin code instead of sending raw text
- [x] Plugin AI tools are visible and executable by Gemini / LLMs
- [x] All 177 test files pass and zero TypeScript errors (`npm run typecheck`)

---

## External Plugin — Voice Transcriber (`messageAction: transcribe`) ✅ DONE

### Goal
Implement a standalone external microkernel plugin (`com.smartchat.voice-transcriber`) packaged as a dynamic `.scext` file that contributes a `messageAction` (`transcribe`, "Transcribe Audio"). When executed on an audio voice message, it automatically downloads and resolves the audio media via the microkernel, decodes the audio via FFmpeg, transcribes English speech using `@xenova/transformers` (Whisper model), and replies to the chat JID with the transcription text.

### What Was Built & Fixed

1. **Standalone Voice Transcriber External Plugin (`com.smartchat.voice-transcriber`)**
   - Created `plugins/voice-transcriber-plugin/manifest.json` registering `messageActions` contribution `id: transcribe` ("Transcribe Audio", `icon: mic`) with required capabilities (`messages:read`, `messages:send`, `ai:chat`, `ui:notification`, `ui:toast`, `events:*`).
   - Implemented `plugins/voice-transcriber-plugin/index.js` handling `contribution:execute:message-action` for `transcribe`.
   - Preinstalled `@xenova/transformers` dependencies in `plugins/voice-transcriber-plugin/node_modules/` and bundled them into `plugins/voice-transcriber.scext`.

2. **First-Class Microkernel Media Downloading (`kernel:messages:downloadMedia`)**
   - Enhanced `KernelMessagesModule` (`src/main/kernel/api-modules/KernelMessagesModule.ts`) to handle `downloadMedia({ messageId })`.
   - Connected `services.mediaService` in `KernelBootstrapper.ts`. If an audio message has not been fetched locally yet, the microkernel automatically downloads and caches the media file from WhatsApp CDN, returning the exact local filesystem path (`filePath`) to worker plugins.
   - Updated Plugin SDK interfaces in `packages/sdk/src/context.ts` and `packages/sdk/src/channel.ts` with `downloadMedia(messageId: string)`.

3. **FFmpeg Audio Decoding & `@xenova/transformers` Whisper Engine**
   - Integrated FFmpeg binary path resolution (`getFFmpegBinaryPath`) locating `ffmpeg.exe` via `ffmpeg-static`.
   - Decodes audio files (Ogg Opus/WebM) to 16kHz mono PCM Float32Array buffers.
   - Runs `@xenova/transformers` `pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en')` on the Float32 PCM buffer.
   - Dispatches formatted transcription replies (`🎤 Audio Transcription (English): "..."`) to the chat JID via `kernel:messages:send` with `quotedMsgId`.

### Acceptance Criteria
- [x] Standalone external plugin `.scext` contains manifest, index, package, and preinstalled `node_modules`
- [x] Microkernel provides first-class `kernel:messages:downloadMedia` API to download uncached WhatsApp audio media on demand
- [x] Audio decoding via FFmpeg converts Ogg Opus to 16kHz Float32 PCM
- [x] `@xenova/transformers` Whisper model transcribes English audio and replies directly to the chat
- [x] Zero TypeScript errors (`npm run typecheck`)

---

## Comprehensive Microkernel Architecture, SOLID & Quality Audit ✅ DONE

### Goal
Perform an exhaustive code quality, correctness, and SOLID principles audit across the entire microkernel codebase, resolving all architectural defects, silent runtime failures, memory leak vectors, code duplication, and type safety issues.

### What Was Refactored & Fixed

1. **Silent Runtime Bugs & Execution Channel Wiring**
   - **Bug 1 (Built-in Plugin Execution)**: Fixed unwired `DirectPluginChannel` kernel request handler by connecting `channel.onKernelRequest()` in `PluginHost.registerBuiltin()`. Built-in domain sub-APIs (`chats`, `messages`, `contacts`, `ai`, `ui`, `storage`) are now fully attached to built-in `PluginContext`. In renderer context menus (`ChatList.tsx`), `executeContribution` is executed as the primary path.
   - **Bug 2 (Event Bus Forwarding & Sanitization)**: Updated `KernelEventsModule.subscribe` to forward event bus emissions to subscribing plugins via `channel.sendToPlugin({ type: 'kernel:events:emit', ... })`. Added payload sanitization (`sanitizeForPlugin`) to remove internal `sock` objects, functions, symbols, and convert JavaScript `bigint` values to strings. Cleaned up duplicate event listeners on re-subscription.
   - **Bug 3 (Real AI Tools Delegation)**: Wired concrete `AITool` implementations from `services.toolRegistry` into `AIAssistantPlugin`. Protected existing tools in `contributionIpc.ts` from being overwritten by external IPC request wrappers. Forwarded tool execution responses in `DirectPluginChannel.sendResponseToPlugin({ id, ok: true, payload: result })`.

2. **SOLID Architecture Compliance**
   - **Dependency Inversion Principle (DIP)**: Extracted `IPluginLoader`, `IPluginRegistry`, and `IKernelAPIRouter` interface abstractions; decoupled `PluginHost` from concrete implementations. Injected `getUserDataPath` dependency into `KernelMessagesModule` constructor to eliminate dynamic `require('electron')` calls.
   - **Open-Closed Principle (OCP)**: 
     - Replaced hardcoded `if`-statements in SDK `WorkerPluginRuntime` with dynamic `incomingHandlers` registry and `registerIncomingHandler()`.
     - Replaced hardcoded 15-slot array in `getContributionSnapshot()` (`contributionIpc.ts`) with dynamic `IContributionRegistry.getAllSlots()`.
     - Replaced hardcoded contribution parsing in `PluginHost.load()` with a declarative `MANIFEST_TO_SLOT_MAPPINGS` table.
   - **Liskov Substitution Principle (LSP)**: Removed optional `sendRequestToPlugin?` from `IPluginChannel`, creating `IBidirectionalPluginChannel extends IPluginChannel` and exporting `isBidirectionalPluginChannel()` type guard.

3. **Code Quality, DRY & Type Safety Hardening**
   - **DRY Refactoring (`BaseKernelModule`)**: Extracted abstract `BaseKernelModule` containing common helper methods (`extractAction`, `requireCapability`, `requireResourceScope`, `serialize`), eliminating 21 duplicated validation and serialization helper functions across all 7 kernel API modules.
   - **Typed Error Hierarchy (`KernelErrors`)**: Created structured `KernelError`, `KernelPermissionError`, and `KernelNotFoundError` class hierarchy, replacing plain object throws (`throw { code, message }`) to preserve V8 stack traces and `instanceof Error` semantics.
   - **Strict Type Safety**: Unified `PluginContext` between SDK (`packages/sdk/src/context.ts`) and Kernel (`src/main/kernel/plugins/PluginContext.ts`). Removed loose `[key: string]: unknown` index signatures and `(ctx as any)` type assertions across built-in plugins. Replaced bare `Function` types in `PluginHost` with `ContributionHandler`.
   - **Clean Composition**: Refactored `KernelEventsModule` to accept `bus: IWAEventBus | null` directly via constructor dependency injection instead of a closure getter. Re-ordered mid-file imports to the top of all files.

### Acceptance Criteria
- [x] All built-in and external plugin contribution execution paths operate cleanly without dropping requests
- [x] Full SOLID principles compliance (DIP, OCP, LSP) across Kernel Host, APIRouter, Channels, and IPC layers
- [x] All 7 Kernel API Modules extend `BaseKernelModule` with typed `KernelError` hierarchy
- [x] Zero loose `any` casts or index signatures on `PluginContext`
- [x] All 30 Vitest test suites (203+ tests) pass cleanly with 0 failures
- [x] Zero TypeScript errors (`npm run typecheck`) across `tsconfig.node.json` and `tsconfig.web.json`

---

## Built-in Plugin Events, Scheduler Wiring & Dynamic AI Tool Routing ✅ DONE

### Goal
Close two critical capability gaps discovered post-audit: built-in plugins had no way to subscribe to WhatsApp events or schedule work; and `KernelAIModule.registerTool` dispatched to a stub handler instead of routing back to the registering plugin.

### What Was Built & Fixed

1. **Built-in Plugin `events` & `scheduler` APIs (PluginHost + DirectPluginChannel)**
   - Updated `PluginHost.registerBuiltin()` to maintain a per-plugin `eventHandlers: Map<string, Set<handler>>`.
   - Extended `channel.onKernelRequest` to intercept `type === 'kernel:events:emit'` and dispatch event payloads directly to in-process handler sets, bypassing the worker thread message pipeline.
   - Attached `events` (`IPluginEventsAPI`) and `scheduler` (`IPluginSchedulerAPI`) on built-in `PluginContext`. Built-in plugins can now use `ctx.events.on('messages:upsert', handler)` and `ctx.scheduler.setInterval(ms, fn)`.
   - Promoted `DirectPluginChannel` to implement `IBidirectionalPluginChannel` — added `sendRequestToPlugin(msg)` allowing the kernel to send requests to built-in plugins and await their in-process responses.

2. **`KernelAIModule` Dynamic AI Tool Execution Routing**
   - Added constructor parameter `getChannel?: (pluginId: string) => IPluginChannel | undefined` to `KernelAIModule`.
   - Replaced the stub `execute` handler in `registerTool` with real channel dispatch: when an LLM calls a dynamically-registered tool, `KernelAIModule` looks up the registering plugin's channel, calls `channel.sendRequestToPlugin({ type: 'contribution:execute:ai-tool', payload: { name, args } })`, and returns the result text to the AI engine.
   - Uses `isBidirectionalPluginChannel()` type guard to safely route only when supported.
   - Updated `KernelBootstrapper.ts` to pass `(pluginId) => pluginRegistry.get(pluginId)?.channel` into `KernelAIModule`.

### Acceptance Criteria
- [x] Built-in plugins receive `events` and `scheduler` on `PluginContext` at activation
- [x] `ctx.events.on(event, handler)` correctly wires and dispatches WhatsApp events to built-in in-process handlers
- [x] `ctx.scheduler.setInterval` and `ctx.scheduler.setTimeout` are available on built-in context
- [x] Dynamically registered AI tools dispatch to the registering plugin's channel via `sendRequestToPlugin` and return real tool output
- [x] `DirectPluginChannel` implements `IBidirectionalPluginChannel` — `sendRequestToPlugin` fully functional in-process
- [x] All 23 kernel test files (114 tests) pass cleanly
- [x] Zero TypeScript errors (`npm run typecheck`)

---



## Future Phases (Not Scoped Yet)

The following are planned but not detailed until earlier phases are complete.
Add detailed phase specs here when ready to execute:

- **Phase 11 — Panel UI** (`ui:panel` webview-based panels for sidebar-panel and settings-page contributions)
- **Phase 12 — Completion Providers** (inline suggestions while typing, `@` modal from plugins)
- **Phase 13 — Message Send Pipeline** (plugin interceptors before send)
- **Phase 14 — Inter-plugin API** (plugin exposes and another imports an API)
- **Phase 15 — Permission UI** (Settings → Extensions → Permissions page)
- **Phase 16 — Chat Badge Computation** (live badge updates from plugins on chat list)

