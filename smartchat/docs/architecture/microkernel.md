# SmartChat — Microkernel Architecture Spec

> **This document is the ground truth for the microkernel refactor.**
> It contains only things that will NOT go stale: decisions, rationale, interface contracts,
> and rules. It does NOT enumerate every existing file or service — agents discover those
> by reading the codebase at execution time.
>
> See `microkernel-phases.md` for the phase-by-phase task tracker.

---

## §1 — Architectural Decisions

### §1.1 What "Microkernel" Means Here

The kernel is the minimal, stable core:
- All database access (Prisma/SQLite)
- WhatsApp connection lifecycle (Baileys)
- The typed event bus
- The plugin host and lifecycle management
- The contribution registry

Everything else — chat actions, AI tools, search, message formatting, notifications — is a
**plugin** that extends the kernel by registering into contribution points.

The kernel exposes a **versioned API surface** (`IKernelModule` interfaces). Plugins interact
with the kernel exclusively through this surface. The kernel never calls plugin code directly;
it routes events and messages to plugins through `IPluginChannel`.

### §1.2 Plugin Isolation: Worker Threads

External plugins run in dedicated Node.js worker threads.

**Rationale:**
- Worker threads share the same process but NOT the same heap (no accidental shared-state bugs)
- MessageChannel-based communication gives a clear, auditable message boundary
- No full process serialization overhead of child_process IPC
- Electron apps already use worker threads heavily (embedding worker is an example in this codebase)
- True OS-level child_process isolation is overkill for a local desktop app

**Built-in plugins** (internal features that dogfood the API) use `DirectPluginChannel` — same
`IPluginChannel` interface, but implemented as direct in-process function calls with no
serialization. Zero overhead, full power.

**Decision on Node.js built-in blocking inside workers:**
External plugin workers can access the filesystem and network through Node.js built-ins. This is
intentionally permissive — SmartChat is a desktop app for power users, not a public marketplace.
A future phase can add vm.Module sandboxing if an extension marketplace is introduced.

### §1.3 UI Contribution Model: Hybrid

Simple contributions (chat-action, message-action, chat-badge, status-bar-item, slash-command,
keyboard-shortcut, chat-filter, chat-sort-strategy) are **data-driven**: plugins declare structured
data and the host renders them using the app's own design system.

Complex contributions (sidebar-panel, settings-page, message-renderer) support **panel mode**:
plugins ship a `panel/index.html` rendered inside a sandboxed Electron `<webview>`. The kernel
provides a `postMessage` bridge so the panel can call kernel APIs.

Panels get an optional **layout shell** from the host (header with plugin name/icon, close
button) — the plugin renders its content area. Design tokens are pushed to panels via the bridge
so they can optionally theme-match.

### §1.4 Built-in Plugins Dogfood the Same API

All internal features (pin chat, mute, AI tools, search panel, notification settings) are
restructured as built-in plugins registered with the kernel. They use `DirectPluginChannel`, so
there is no performance penalty. The contribution they register is identical in type to what an
external plugin would register.

The kernel does not distinguish between built-in and external plugins at the contribution registry
level. The only difference is the `IPluginChannel` implementation used.

### §1.5 Existing Service Layer Is Not Rewritten

The existing `ServiceContainer.ts`, all services, and all repositories are NOT touched during
this refactor. They become the kernel's internal implementation. Kernel API modules
(`IKernelModule` implementations) are thin, typed adapters that:
1. Validate permissions
2. Delegate to the existing service interfaces
3. Serialize responses into the `KernelResponse` wire format

This preserves all existing SOLID/DI work and all existing tests.

### §1.6 Permissions: ABAC with User-Controlled Settings

Plugins declare permissions in their manifest. Users toggle permissions in
`Settings → Extensions → [Plugin] → Permissions`.

Permissions are checked at every kernel API call boundary. The check is:
1. Does the plugin have this capability? (coarse: `messages:send`)
2. Does the resource being accessed match the declared scope? (fine: specific chat JID, contact whitelist, tool allowlist)

Built-in plugins are always granted all permissions — no check performed.
The permission system is pluggable: `IPermissionStore` is the interface, implementations can
range from a simple flat JSON file to a full ABAC engine.

### §1.7 Manifest Format: v2 (`.scext` zip archive kept)

The `.scext` zip format is kept. The `manifest.json` inside is redesigned to v2.
See §4 for the full manifest type definition.

### §1.8 SDK: `@smartchat/sdk` in `packages/sdk/`

An optional but strongly recommended SDK package for plugin authors. Provides:
- Full TypeScript types for `PluginContext`, all kernel APIs, all contribution point shapes
- The `WorkerPluginRuntime` — the in-worker implementation of `PluginContext` that translates
  API calls into `postMessage` calls to the kernel
- Manifest schema with zod validation
- No runtime dependencies beyond what's included

---

## §2 — Core Abstractions

### §2.1 `IPluginChannel`

The transport-agnostic message boundary between the kernel and any plugin.
The kernel NEVER depends on a concrete channel implementation.

```typescript
// src/main/kernel/channels/IPluginChannel.ts

export interface KernelRequest {
  id: string           // correlation ID for request/response matching
  type: string         // e.g. 'kernel:chats:getList', 'contribution:execute'
  payload: unknown
}

export interface KernelResponse {
  id: string           // matches KernelRequest.id
  ok: boolean
  payload?: unknown
  error?: KernelErrorPayload
}

export interface KernelErrorPayload {
  code: KernelErrorCode
  message: string
  permission?: string  // set when code === 'PERMISSION_DENIED'
}

// OCP: KernelErrorCode is an open string type — kernel modules add their own codes.
// Known built-in codes are documented here but the type is not closed.
export type KernelErrorCode = string

// Known built-in codes (not exhaustive):
// 'PERMISSION_DENIED' — capability check failed (includes .permission field)
// 'NOT_FOUND'         — requested resource does not exist
// 'INVALID_ARGS'      — payload failed schema validation
// 'INTERNAL_ERROR'    — unexpected error inside a kernel module
// 'PLUGIN_NOT_FOUND'  — referenced pluginId is not loaded

export interface IPluginChannel {
  /** Send a message from kernel to plugin (e.g. execute a contribution handler) */
  sendToPlugin(msg: KernelRequest): void
  /** Send a response from kernel to plugin (answering a plugin-originated request) */
  sendResponseToPlugin(msg: KernelResponse): void
  /** Register handler for requests arriving FROM the plugin */
  onPluginRequest(handler: (msg: KernelRequest) => Promise<void>): void
  /** Terminate the channel and release resources */
  destroy(): void
}
```

### §2.2 `IPluginHost`

```typescript
// src/main/kernel/plugins/IPluginHost.ts

export interface PluginMetadata {
  id: string
  manifest: PluginManifest  // §4
  channel: IPluginChannel
  isBuiltin: boolean
}

export interface IPluginHost {
  /** Load and activate a plugin by its ID. Idempotent if already loaded. */
  load(id: string): Promise<void>
  /** Deactivate and unload a plugin, releasing its channel. */
  unload(id: string): Promise<void>
  /** Unload then reload a plugin (clears require cache for external plugins). */
  reload(id: string): Promise<void>
  /** Load all installed external plugins from disk. */
  loadAll(): Promise<void>
  /** Register a built-in plugin (uses DirectPluginChannel). */
  registerBuiltin(plugin: IBuiltinPlugin): Promise<void>
  getPlugin(id: string): PluginMetadata | undefined
  listLoaded(): string[]
}
```

### §2.3 `IBuiltinPlugin`

The interface every built-in plugin module must implement.
Built-ins are in-process; they receive a `PluginContext` via `DirectPluginChannel`.

```typescript
// src/main/kernel/plugins/IBuiltinPlugin.ts

export interface IBuiltinPlugin {
  readonly id: string
  readonly manifest: PluginManifest
  activate(ctx: PluginContext): Promise<void>
  deactivate(): Promise<void>
}
```

### §2.4 `IPermissionStore`

```typescript
// src/main/kernel/permissions/IPermissionStore.ts

export interface PermissionScope {
  /** Explicit allow-list of resource IDs (JIDs, tool names, etc.). Empty = all allowed. */
  allow?: string[]
  /** Explicit deny-list. Applied after allow. */
  deny?: string[]
}

export interface IPermissionStore {
  /** Coarse check: does this plugin have this capability at all? */
  hasCapability(pluginId: string, capability: string): boolean
  /**
   * Fine-grained check: is this specific resource ID allowed for this capability?
   * Returns true if no scope is configured (default-allow).
   */
  isResourceAllowed(pluginId: string, capability: string, resourceId: string): boolean
  /** Persist a permission toggle from the user's Settings UI. */
  setCapability(pluginId: string, capability: string, granted: boolean): Promise<void>
  /** Persist a scope restriction. */
  setScope(pluginId: string, capability: string, scope: PermissionScope): Promise<void>
  /** Return full permission state for a plugin (used by Settings UI). */
  getPluginPermissions(pluginId: string): PluginPermissionState
}

export interface PluginPermissionState {
  pluginId: string
  capabilities: Record<string, { granted: boolean; scope?: PermissionScope }>
}
```

### §2.5 `IContributionRegistry`

```typescript
// src/main/kernel/contributions/IContributionRegistry.ts

export interface IContributionRegistry {
  /** Register a contribution. Called by plugins during activation. */
  register<K extends ContributionSlot>(
    slot: K,
    contribution: ContributionMap[K]
  ): void
  /** Remove all contributions from a given plugin. Called on unload. */
  unregisterAll(pluginId: string): void
  /** Get all contributions for a slot. Used by the renderer and kernel. */
  getAll<K extends ContributionSlot>(slot: K): ContributionMap[K][]
  /**
   * Subscribe to changes. Fires whenever any plugin registers or unregisters.
   * The kernel pushes snapshots to the renderer over IPC whenever this fires.
   */
  onChange(handler: () => void): () => void
}
```

---

## §3 — Kernel API Modules

Each module wraps existing services (discovered at implementation time by reading the codebase)
and exposes them to plugins through permission-validated, serializable method calls.

All kernel API modules implement this base pattern:

```typescript
// src/main/kernel/api-modules/IKernelModule.ts

export interface IKernelModule {
  /** The prefix used for all request types this module handles, e.g. 'kernel:chats' */
  readonly namespace: string
  /** Dispatch a validated, permission-checked request and return a response payload. */
  handle(pluginId: string, type: string, payload: unknown): Promise<unknown>
}
```

### §3.1 Defined Namespaces

| Namespace | Capabilities Required | What to wrap (discover at implementation time) |
|---|---|---|
| `kernel:chats` | `chats:read`, `chats:write` | Chat service interfaces in ServiceContainer |
| `kernel:messages` | `messages:read`, `messages:send`, `messages:delete` | Message service interfaces |
| `kernel:contacts` | `contacts:read` | Contact service interfaces |
| `kernel:ai` | `ai:chat`, `ai:tools:call`, `ai:tools:register` | AI service, tool registry |
| `kernel:events` | `events:*` | WAEventBus bridge |
| `kernel:storage` | `storage:read`, `storage:write` | Extension storage repository |
| `kernel:ui` | `ui:notification`, `ui:toast`, `ui:panel` | Notification service, BrowserWindow |
| `kernel:contributions` | always available | ContributionRegistry |
| `kernel:plugins` | always available | PluginHost (inter-plugin bus) |

The `KernelAPIRouter` (`src/main/kernel/KernelAPIRouter.ts`) dispatches incoming plugin requests
to the correct module by matching `request.type` against module namespaces.

---

## §4 — Manifest v2

```typescript
// packages/sdk/src/manifest.ts (canonical type definition)

export interface SlashCommand {
  name: string
  description: string
}

export interface CronEntry {
  name: string
  cron: string
}

// OCP: PermissionCapability is an open string type. Each kernel module owns and
// declares its own capability constants — this type is never a closed enum.
// Naming convention: '{domain}:{action}' e.g. 'messages:send', 'chats:read'
export type PermissionCapability = string

// Known built-in capabilities declared by each kernel module at implementation time.
// This list is ILLUSTRATIVE, not exhaustive — agents discover the real set by reading
// the kernel api-modules/ directory:
//
//  chats:read, chats:write
//  messages:read, messages:send, messages:delete
//  contacts:read
//  ai:chat, ai:tools:call, ai:tools:register
//  events:<event-name>  (e.g. events:message:incoming — one per event type)
//  storage:read, storage:write
//  ui:notification, ui:toast, ui:panel
//  scheduler
//  receipts:read
//
// New kernel modules define additional capability strings alongside their IKernelModule
// implementation. No change to this file is needed.

export interface ContributionsDeclaration {
  chatActions?: Array<{ id: string; label: string; icon?: string; when?: string }>
  messageActions?: Array<{ id: string; label: string; icon?: string; when?: string }>
  chatBadges?: Array<{ id: string; label?: string }>
  messageRenderers?: Array<{ id: string; messageType: string }>
  slashCommands?: SlashCommand[]
  sidebarPanels?: Array<{ id: string; title: string; icon?: string; panel?: string }>
  settingsPages?: Array<{ id: string; title: string; panel?: string }>
  aiTools?: Array<{ name: string; description: string; schema: object }>
  keyboardShortcuts?: Array<{ id: string; defaultBinding: string; description: string }>
  statusBarItems?: Array<{ id: string; alignment: 'left' | 'right' }>
  chatFilters?: Array<{ id: string; label: string; icon?: string }>
  chatSortStrategies?: Array<{ id: string; label: string }>
  completionProviders?: Array<{ id: string; trigger: string; context: 'chatbar' | 'search' }>
  messageSendPipeline?: Array<{ id: string; priority: number }>
  pluginApiExports?: string[]
}

export interface PluginManifest {
  id: string                          // Reverse-domain format: 'com.acme.my-plugin'
  name: string
  version: string
  apiVersion: '2'
  main: string                        // Entry point relative to archive root
  permissions: PermissionCapability[]
  contributions: ContributionsDeclaration
  scheduler?: {
    onStart: boolean
    intervals: CronEntry[]
  }
}
```

---

## §5 — Contribution Point Types

All contributions carry `pluginId` (injected by the registry on registration, never by the plugin).

```typescript
// src/main/kernel/contributions/ContributionPoints.ts

export interface ChatActionContribution {
  pluginId: string
  id: string
  label: string
  icon?: string
  when?: string  // optional condition expression e.g. "chat.isGroup"
}

export interface MessageActionContribution {
  pluginId: string
  id: string
  label: string
  icon?: string
  when?: string
}

export interface ChatBadgeContribution {
  pluginId: string
  id: string
  label?: string
}

export interface SlashCommandContribution {
  pluginId: string
  name: string
  description: string
}

export interface KeyboardShortcutContribution {
  pluginId: string
  id: string
  defaultBinding: string
  description: string
}

export interface StatusBarItemContribution {
  pluginId: string
  id: string
  alignment: 'left' | 'right'
}

export interface ChatFilterContribution {
  pluginId: string
  id: string
  label: string
  icon?: string
}

export interface ChatSortStrategyContribution {
  pluginId: string
  id: string
  label: string
}

export interface CompletionProviderContribution {
  pluginId: string
  id: string
  trigger: string
  context: 'chatbar' | 'search'
}

export interface SidebarPanelContribution {
  pluginId: string
  id: string
  title: string
  icon?: string
  panel?: string  // relative path inside .scext to panel HTML
}

export interface SettingsPageContribution {
  pluginId: string
  id: string
  title: string
  panel?: string
}

export interface AIToolContribution {
  pluginId: string
  name: string
  description: string
  schema: object
}

export interface MessageRendererContribution {
  pluginId: string
  id: string
  messageType: string
  panel?: string
}

export interface MessageSendPipelineContribution {
  pluginId: string
  id: string
  priority: number  // lower = runs first in the pipeline
}

export interface PluginApiExportContribution {
  pluginId: string
  exportName: string
}

// OCP: ContributionMap is an INTERFACE not a type alias, enabling TypeScript
// declaration merging (module augmentation). Adding a new contribution slot in a
// future phase requires only:
//   1. Defining a new contribution interface
//   2. Adding one line to ContributionMap via augmentation in a new file:
//      declare module './ContributionPoints' {
//        interface ContributionMap { 'my-new-slot': MyNewContribution }
//      }
// No modification to this file is ever needed.
export interface ContributionMap {
  'chat-action': ChatActionContribution
  'message-action': MessageActionContribution
  'chat-badge': ChatBadgeContribution
  'slash-command': SlashCommandContribution
  'keyboard-shortcut': KeyboardShortcutContribution
  'status-bar-item': StatusBarItemContribution
  'chat-filter': ChatFilterContribution
  'chat-sort-strategy': ChatSortStrategyContribution
  'completion-provider': CompletionProviderContribution
  'sidebar-panel': SidebarPanelContribution
  'settings-page': SettingsPageContribution
  'ai-tool': AIToolContribution
  'message-renderer': MessageRendererContribution
  'message-send-pipeline': MessageSendPipelineContribution
  'plugin-api-export': PluginApiExportContribution
}

// Derived from ContributionMap — automatically includes augmented slots
export type ContributionSlot = keyof ContributionMap
```

---

## §6 — PluginContext (Plugin-side API)

What every plugin — built-in or external — receives on activation.

```typescript
// packages/sdk/src/context.ts

export interface PluginContext {
  readonly id: string
  readonly manifest: PluginManifest

  onActivate(fn: () => Promise<void>): void
  onDeactivate(fn: () => Promise<void>): void

  readonly log: IPluginLogAPI            // always available

  readonly chats?: IPluginChatsAPI       // requires chats:read
  readonly messages?: IPluginMessagesAPI // requires messages:read / messages:send
  readonly contacts?: IPluginContactsAPI // requires contacts:read
  readonly ai?: IPluginAIAPI             // requires ai:chat / ai:tools:*
  readonly events?: IPluginEventsAPI     // requires events:*
  readonly storage?: IPluginStorageAPI   // requires storage:read / storage:write
  readonly ui?: IPluginUIAPI             // requires ui:*
  readonly scheduler?: IPluginSchedulerAPI // requires scheduler

  readonly contributions: IPluginContributionsAPI  // always available
}

export interface IPluginLogAPI {
  info(msg: string, ...data: unknown[]): void
  warn(msg: string, ...data: unknown[]): void
  error(msg: string, ...data: unknown[]): void
}

export interface IPluginChatsAPI {
  getList(page: number, limit: number): Promise<PluginChatItem[]>
  getById(jid: string): Promise<PluginChatItem | null>
  pin(jid: string): Promise<void>
  unpin(jid: string): Promise<void>
  archive(jid: string): Promise<void>
  unarchive(jid: string): Promise<void>
  mute(jid: string, durationMs: number): Promise<void>
  unmute(jid: string): Promise<void>
  markRead(jid: string): Promise<void>
}

export interface IPluginMessagesAPI {
  getMessages(jid: string, page: number, limit: number): Promise<PluginMessageItem[]>
  send(jid: string, text: string, options?: SendMessageOptions): Promise<PluginMessageItem>
  delete(jid: string, messageId: string): Promise<void>
  react(jid: string, messageId: string, emoji: string): Promise<void>
}

export interface IPluginContactsAPI {
  getByJid(jid: string): Promise<PluginContactItem | null>
}

export interface IPluginEventsAPI {
  on<K extends PluginEventName>(
    event: K,
    handler: (payload: PluginEventMap[K]) => void | Promise<void>
  ): () => void  // returns unsubscribe fn
}

export interface IPluginStorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}

export interface IPluginSchedulerAPI {
  setInterval(ms: number, fn: () => void | Promise<void>): () => void
  setTimeout(ms: number, fn: () => void | Promise<void>): () => void
  onCron(name: string, fn: () => void | Promise<void>): void
}

export interface IPluginUIAPI {
  notify(opts: { title: string; body: string }): Promise<void>
  toast(msg: string, level?: 'info' | 'success' | 'warning' | 'error'): void
}

export interface IPluginAIAPI {
  chat(prompt: string, options?: AICallOptions): Promise<string>
  callTool(toolName: string, args: Record<string, unknown>): Promise<{ text: string }>
}

export interface IPluginContributionsAPI {
  registerChatAction(
    id: string,
    handler: (ctx: ChatActionContext) => Promise<void>
  ): void
  registerMessageAction(
    id: string,
    handler: (ctx: MessageActionContext) => Promise<void>
  ): void
  registerChatBadge(
    id: string,
    compute: (chatJid: string) => Promise<BadgeDescriptor | null>
  ): void
  registerSlashCommand(
    name: string,
    handler: (args: string, context: CommandContext) => Promise<void>
  ): void
  registerAITool(
    name: string,
    execute: (args: Record<string, unknown>) => Promise<{ text: string }>
  ): void
  registerCompletionProvider(
    id: string,
    provide: (ctx: CompletionContext) => Promise<CompletionItem[]>
  ): void
  registerMessageSendInterceptor(
    id: string,
    intercept: (
      payload: OutgoingMessagePayload,
      next: (payload: OutgoingMessagePayload) => Promise<SendResult>
    ) => Promise<SendResult>
  ): void
  exposeAPI(exportName: string, api: Record<string, unknown>): void
  importAPI(pluginId: string, exportName: string): Promise<Record<string, unknown>>
}
```

---

## §7 — Message Protocol (Plugin ↔ Kernel)

All messages use `KernelRequest` / `KernelResponse` (§2.1).

### Request type naming convention

`{namespace}:{action}` format:
- `kernel:chats:getList` — plugin requests chat list
- `kernel:messages:send` — plugin sends a message
- `kernel:contributions:register` — plugin registers a contribution handler
- `contribution:execute:chat-action` — kernel triggers a plugin's chat action handler
- `contribution:compute:chat-badge` — kernel asks plugin to compute a badge

### Contribution execution flow (kernel → plugin)

```
User clicks "My Action" in renderer
  → renderer: IPC window.api.executeContribution({ slot, pluginId, id, context })
  → KernelAPIRouter routes to ContributionExecutor
  → ContributionExecutor finds the plugin channel for pluginId
  → channel.sendToPlugin({ type: 'contribution:execute:chat-action', id, payload: context })
  → plugin worker receives, looks up registered handler, calls it
  → handler calls ctx.messages.send(...) → postMessage to kernel
  → kernel validates permission, executes, returns response
```

### Plugin-originated request flow (plugin → kernel)

```
plugin: ctx.messages.send(jid, text)
  → WorkerPluginRuntime: postMessage({ id: uuid(), type: 'kernel:messages:send', payload })
  → KernelAPIRouter receives
  → validates: hasCapability(pluginId, 'messages:send')
  → if denied: sendResponseToPlugin({ id, ok: false, error: { code: 'PERMISSION_DENIED' } })
  → if allowed: KernelMessagesModule.handle(pluginId, 'send', payload)
  → result: sendResponseToPlugin({ id, ok: true, payload: result })
  → WorkerPluginRuntime resolves the awaited Promise
```

---

## §8 — Renderer Integration

### §8.1 ContributionContext

The renderer maintains a live snapshot of the contribution registry pushed over IPC.

```typescript
// src/renderer/src/context/ContributionContext.tsx

// Provides contributions to all React components
const ContributionContext = createContext<ContributionRegistrySnapshot>({})

// Hook for reading a specific slot
function useContributions<K extends ContributionSlot>(slot: K): ContributionMap[K][]
```

### §8.2 Contribution Execution from Renderer

All execution goes through a single IPC call:

```typescript
window.api.executeContribution({
  slot: 'chat-action',
  pluginId: 'com.acme.my-plugin',
  id: 'archive-all',
  context: { chatJid: '...' }
})
```

### §8.3 Components to Update

Components with hardcoded actions/UI must be updated to read from `useContributions()`.
The exact components are discovered at implementation time by exploring `src/renderer/src/components/`.
Expect to update: chat list rendering, message bubble context menus, chatbar, sidebar, settings.

---

## §9 — Directory Structure (Target State)

New directories introduced by this refactor. Existing `src/main/services/` is unchanged.

```
src/main/kernel/
├── KernelAPIRouter.ts
├── KernelBootstrapper.ts
├── channels/
│   ├── IPluginChannel.ts
│   ├── WorkerPluginChannel.ts
│   └── DirectPluginChannel.ts
├── plugins/
│   ├── IPluginHost.ts
│   ├── IBuiltinPlugin.ts
│   ├── PluginHost.ts
│   ├── PluginRegistry.ts
│   └── PluginLoader.ts
├── permissions/
│   ├── IPermissionStore.ts
│   └── PermissionStore.ts
├── contributions/
│   ├── IContributionRegistry.ts
│   ├── ContributionRegistry.ts
│   └── ContributionPoints.ts
└── api-modules/
    ├── IKernelModule.ts
    ├── KernelChatsModule.ts
    ├── KernelMessagesModule.ts
    ├── KernelContactsModule.ts
    ├── KernelAIModule.ts
    ├── KernelEventsModule.ts
    ├── KernelStorageModule.ts
    └── KernelUIModule.ts

src/main/plugins/
├── builtin/
│   ├── whatsapp-core/
│   ├── ai-assistant/
│   ├── search/
│   └── notifications/
└── external/
    └── (runtime: userData/extensions/)

packages/sdk/
├── src/
│   ├── manifest.ts
│   ├── context.ts
│   ├── contributions.ts
│   ├── events.ts
│   ├── channel.ts
│   └── index.ts
└── package.json

src/main/tests/kernel/
└── (tests added per phase)
```

---

## §10 — Invariant Rules (Every Agent Session Must Follow)

1. **No concrete imports across module boundaries.** Kernel modules depend on `IService`
   interfaces from the existing service layer, never on concrete classes.

2. **No service layer changes.** `src/main/services/` is a read-only dependency of the kernel.
   Do not modify any existing service, repository, or interface file.

3. **No direct registry access from plugins.** Plugins call `ctx.contributions.register*` only.
   They never import `ContributionRegistry` directly.

4. **Permissions checked at the kernel boundary, not inside services.** Services remain
   permission-unaware. Validation always happens in the kernel API module before any delegation.

5. **All KernelRequest/KernelResponse payloads must be JSON-serializable.** No class instances,
   functions, Symbols, or Buffers. Required for WorkerPluginChannel to work correctly.

6. **Existing tests must not regress.** Run `npx vitest run --project main` after every change.
   If a pre-existing test fails, fix it before continuing.

7. **TDD order per phase.** Write tests first (RED). Then implement (GREEN). Never implement
   before a test exists.

8. **Built-in plugins use `DirectPluginChannel`.** Never spin up a worker thread for built-ins.

9. **The renderer reads contributions only from ContributionContext.** No component directly
   imports from kernel code or calls IPC bypassing `window.api.executeContribution`.

10. **`apiVersion: '2'` is required.** The old v1 manifest format is rejected by `PluginLoader`.
