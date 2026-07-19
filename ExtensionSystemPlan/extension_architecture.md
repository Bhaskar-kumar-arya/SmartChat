# SmartChat Extension System — Architecture Plan

---

## 1  Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  BOOTSTRAP  (index.ts)                                          │
│  Creates ExtensionHost after ServiceContainer is ready          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  HOST LAYER                                                      │
│  ExtensionHost  ←→  IExtensionLoader                            │
│       │         ←→  IExtensionCapabilityRegistry                │
│       │         ←→  IExtensionSchedulerService                  │
│       │         ←→  IDedicatedChatSessionManager                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ builds ctx per extension
┌───────────────────────────▼─────────────────────────────────────┐
│  CAPABILITY LAYER                                                │
│  ExtensionCapabilityRegistry                                     │
│    ICapabilityProvider<IExtensionEventAPI>                      │
│    ICapabilityProvider<IExtensionStorageAPI>                    │
│    ICapabilityProvider<IExtensionToolAPI>        ← send/react/  │
│    ICapabilityProvider<IExtensionContactsAPI>      star/archive/ │
│    ICapabilityProvider<IExtensionChatsAPI>         pin/mute all  │
│    ICapabilityProvider<IExtensionSchedulerAPI>     go via tools  │
│    ICapabilityProvider<IExtensionUIAPI>                         │
│    ICapabilityProvider<IExtensionDedicatedChatAPI>              │
│    LogCapabilityProvider  (always injected, no permission)      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ delegate to
┌───────────────────────────▼─────────────────────────────────────┐
│  INFRASTRUCTURE LAYER                                            │
│  ExtensionEventBridge    → IWAEventBus (read-only tap)         │
│  ExtensionStorageRepo    → Prisma (ExtensionKV table)           │
│  DedicatedChatRepo       → Prisma (ExtensionChatMessage table)  │
│  VirtualChatProvider     → IChatRepository (synthetic entries)  │
│  ExtensionSchedulerSvc   → node-cron / setInterval             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ depend on
┌───────────────────────────▼─────────────────────────────────────┐
│  SMARTCHAT CORE  (existing, unchanged)                           │
│  IWAEventBus · IChatService · IContactService                   │
│  IToolRegistry · INotificationService                           │
│  IChatRepository · IMessageQueryRepository                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2  Component Catalog

### 2.1  Host Layer

| Class | Interface | Responsibility |
|---|---|---|
| `ExtensionLoader` | `IExtensionLoader` | Unzip `.scext`, validate manifest, `require()` entry point, clear require cache on reload |
| `ExtensionHost` | `IExtensionHost` | Lifecycle: `loadAll / load / unload / reload`. Calls `onActivate` / `onDeactivate`. Owns no business logic. |
| `ExtensionCapabilityRegistry` | `IExtensionCapabilityRegistry` | Holds all `ICapabilityProvider`s. Builds a per-manifest `ExtensionContext` by calling each provider. |

### 2.2  Capability Layer

> **Rule:** A dedicated `ctx` API only exists when the return value is **structured typed data** that the extension needs to use programmatically. Fire-and-forget mutations (send, react, star, archive, pin, mute) go through `ctx.tools.call(...)` — the tools already exist and return `{ text }` which is sufficient for actions.

| Provider Class | Produces | Permission Required | Justification |
|---|---|---|---|
| `EventCapabilityProvider` | `IExtensionEventAPI` | any `events:*` | Events aren't tools |
| `StorageCapabilityProvider` | `IExtensionStorageAPI` | `storage:read` / `storage:write` | No tool for KV store |
| `ToolCapabilityProvider` | `IExtensionToolAPI` | `tools:read` / `tools:register` | Gateway to all built-in tools + registration |
| `ContactsCapabilityProvider` | `IExtensionContactsAPI` | `contacts:read` | No tool returns typed contact data |
| `ChatsCapabilityProvider` | `IExtensionChatsAPI` | `chats:read` | No tool returns a typed chat list |
| `SchedulerCapabilityProvider` | `IExtensionSchedulerAPI` | `scheduler` | No tool equivalent |
| `UICapabilityProvider` | `IExtensionUIAPI` | `ui:notification` | No tool equivalent |
| `DedicatedChatCapabilityProvider` | `IExtensionDedicatedChatAPI` | `ui:dedicated_chat` | No tool equivalent |
| `LogCapabilityProvider` | `IExtensionLogAPI` | *(always present)* | No tool equivalent |

**Dropped:** `MessagingCapabilityProvider` — `sendMessage`, `messageAction`, `chatAction` tools cover all mutations (send, react, star, archive, pin, mute) and return `{ text }` which is sufficient.

### 2.3  Infrastructure Layer

| Class | Interface | Responsibility |
|---|---|---|
| `ExtensionEventBridge` | `IExtensionEventBridge` | Subscribes to `IWAEventBus`; strips unsafe fields (`sock`, raw Baileys refs); re-emits to per-extension handlers |
| `ExtensionStorageRepository` | `IExtensionStorageRepository` | CRUD on `ExtensionKV` table, namespaced by `extensionId` |
| `DedicatedChatRepository` | `IDedicatedChatRepository` | Persists `ExtensionChatMessage` rows; namespaced by `extensionId` |
| `DedicatedChatSessionManager` | `IDedicatedChatSessionManager` | In-memory session state per extension; routes user input to the extension's handler |
| `VirtualChatProvider` | `IVirtualChatProvider` | Writes `ChatListEntry { source: 'extension' }` rows. **Requires adding `source` and `extensionId` fields to the existing `chatList.types.ts` domain type.** |
| `ExtensionSchedulerService` | `IExtensionSchedulerService` | Owns all cron/interval/timeout handles per extension; cancels all on `unload()` |

---

## 3  All Interfaces

### 3.1  Core Extension Interfaces

```ts
// Manifest
interface ExtensionManifest {
  id: string
  version: string
  apiVersion: string        // e.g. "1" — host rejects incompatible versions
  name: string
  description: string
  main: string              // entry-point filename
  permissions: string[]     // e.g. ['events:message:incoming', 'storage:read', 'tools:read']
  dedicatedChat?: { name: string; avatarEmoji: string; commands: SlashCommand[] }
  scheduler?: { onStart: boolean; intervals: CronEntry[] }
}

// Loader
interface IExtensionLoader {
  install(scextPath: string): Promise<ExtensionManifest>
  uninstall(id: string): Promise<void>
  load(id: string): Promise<ExtensionModule>   // require()s the module
  reload(id: string): Promise<ExtensionModule> // clears require.cache first
  listInstalled(): Promise<ExtensionManifest[]>
}

// Supports two entry-point styles — validated at load time
type ExtensionModule =
  | ((ctx: ExtensionContext) => Promise<void>)                  // simple function export
  | { activate(ctx: ExtensionContext): Promise<void>;           // VS Code style
      deactivate?(): Promise<void> }

// Host
interface IExtensionHost {
  loadAll(): Promise<void>
  load(id: string): Promise<void>
  unload(id: string): Promise<void>
  reload(id: string): Promise<void>
  getManifest(id: string): ExtensionManifest | undefined
  listLoaded(): string[]
}
```

### 3.2  Capability Provider Interface

```ts
// The single interface every capability provider implements.
// K = the API type it produces (e.g. IExtensionEventAPI)
interface ICapabilityProvider<K> {
  /** Permission string(s) this capability requires. */
  readonly permissions: string[]
  /**
   * Build the API object for this extension.
   * Returns undefined if manifest lacks required permissions.
   */
  build(manifest: ExtensionManifest): K | undefined
}

interface IExtensionCapabilityRegistry {
  register<K>(key: string, provider: ICapabilityProvider<K>): void
  buildContext(manifest: ExtensionManifest): ExtensionContext
}
```

### 3.3  Extension Context (ctx)

```ts
// ctx is built per-manifest — keys absent if permission not declared
interface ExtensionContext {
  readonly extensionId: string
  readonly manifest: ExtensionManifest
  readonly log: IExtensionLogAPI            // always present
  onActivate(fn: () => Promise<void>): void
  onDeactivate(fn: () => Promise<void>): void

  // Only present if permission declared:
  readonly events?: IExtensionEventAPI
  readonly storage?: IExtensionStorageAPI
  readonly tools?: IExtensionToolAPI        // send/react/star/archive/pin/mute go here
  readonly contacts?: IExtensionContactsAPI
  readonly chats?: IExtensionChatsAPI       // list() only — mutations via ctx.tools
  readonly scheduler?: IExtensionSchedulerAPI
  readonly ui?: IExtensionUIAPI
  readonly dedicatedChat?: IExtensionDedicatedChatAPI
}
```

### 3.4  Capability API Interfaces

```ts
interface IExtensionEventAPI {
  on<K extends ExtensionEventName>(
    event: K,
    handler: (payload: ExtensionEventMap[K]) => void | Promise<void>
  ): () => void  // returns unsubscribe fn
}

// Removed: IExtensionMessagingAPI
// send   → ctx.tools.call('sendMessage',   { jid, text })
// react  → ctx.tools.call('messageAction', { action: 'react', ... })
// star   → ctx.tools.call('messageAction', { action: 'star',  ... })
// archive→ ctx.tools.call('chatAction',    { action: 'archive', jid })

interface IExtensionStorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}

// Split by permission — tools:read gives call(), tools:register gives register()
// ISP: an extension with only tools:register cannot call built-in tools
interface IExtensionToolCallAPI {
  call(toolName: string, args: Record<string, unknown>): Promise<ToolResult>
  list(): string[]
}

interface IExtensionToolRegisterAPI {
  register(tool: ExtensionTool): void
  list(): string[]
}

// ctx.tools is the union of whichever subset the manifest declared
type IExtensionToolAPI = Partial<IExtensionToolCallAPI & IExtensionToolRegisterAPI>

interface IExtensionContactsAPI {
  resolveName(jid: string): Promise<string | null>
  search(query: string): Promise<ContactSummary[]>
  getSelfJid(): Promise<string>
}

// Read-only. Mutations go through ctx.tools.call('chatAction', ...)
interface IExtensionChatsAPI {
  list(limit?: number): Promise<ChatSummary[]>
}

interface IExtensionSchedulerAPI {
  setInterval(ms: number, fn: () => void | Promise<void>): () => void
  setTimeout(ms: number, fn: () => void | Promise<void>): () => void
  onCron(name: string, fn: () => void | Promise<void>): void
}

interface IExtensionUIAPI {
  notify(opts: { title: string; body: string; action?: NotifyAction }): Promise<void>
  toast(msg: string, level?: 'info' | 'success' | 'warning' | 'error'): void
  showSettings(schema: object): Promise<Record<string, unknown>>
}

interface IExtensionDedicatedChatAPI {
  send(content: DedicatedChatContent): Promise<void>
  getHistory(limit?: number): Promise<DedicatedChatMessage[]>
  clearHistory(): Promise<void>
  focus(): void
}

interface IExtensionLogAPI {
  info(msg: string, data?: unknown): void
  warn(msg: string, data?: unknown): void
  error(msg: string, err?: unknown): void
}
```

### 3.5  Infrastructure Interfaces

```ts
interface IExtensionEventBridge {
  subscribeExtension(
    extensionId: string,
    event: ExtensionEventName,
    handler: (payload: unknown) => void | Promise<void>
  ): () => void
  unsubscribeAll(extensionId: string): void
}

interface IExtensionStorageRepository {
  get(extensionId: string, key: string): Promise<string | undefined>
  set(extensionId: string, key: string, value: string): Promise<void>
  delete(extensionId: string, key: string): Promise<void>
  clear(extensionId: string): Promise<void>
  keys(extensionId: string): Promise<string[]>
}

interface IDedicatedChatRepository {
  append(extensionId: string, role: 'user' | 'extension', content: string): Promise<void>
  getHistory(extensionId: string, limit?: number): Promise<DedicatedChatMessage[]>
  clear(extensionId: string): Promise<void>
}

interface IDedicatedChatSessionManager {
  routeUserMessage(extensionId: string, text: string): Promise<void>
  routeButtonPress(extensionId: string, buttonId: string): Promise<void>
  routeCommand(extensionId: string, command: string, args: string): Promise<void>
  registerExtension(extensionId: string, handler: ExtensionChatHandler): void
  unregisterExtension(extensionId: string): void
}

interface IVirtualChatProvider {
  upsert(extensionId: string, manifest: ExtensionManifest): Promise<void>
  remove(extensionId: string): Promise<void>
}

interface IExtensionSchedulerService {
  setInterval(extensionId: string, ms: number, fn: () => void | Promise<void>): () => void
  setTimeout(extensionId: string, ms: number, fn: () => void | Promise<void>): () => void
  registerCron(extensionId: string, name: string, expr: string, fn: () => void | Promise<void>): void
  cancelAll(extensionId: string): void
}
```

---

## 4  Data Flows

### 4.1  Incoming Message → Extension Handler

```
WAEventHandler
  → WAEventBus.emit('message:incoming', { chatJid, ..., sock, processed })
      │
      ▼
ExtensionEventBridge.onWAEvent('message:incoming', raw)
  → strips: sock, processed.rawBaileys
  → safe payload: { chatJid, senderJid, textContent, fromMe, timestamp, enriched }
      │
      ▼  (for each subscribed extension)
extension handler(safePayload)
```

### 4.2  User Types in Dedicated Chat

```
Renderer: user types in ExtensionChatView
  → IPC: ipc:extension:chat-send { extensionId, text }
      │
      ▼
IDedicatedChatSessionManager.routeUserMessage(extensionId, text)
  → IDedicatedChatRepository.append(extensionId, 'user', text)
  → checks if text is slash command → routes to command handler
  → else → fires ctx.events 'extension:chat-message' in extension
      │
      ▼
extension calls ctx.dedicatedChat.send({ type: 'text', text: 'reply' })
  → IDedicatedChatRepository.append(extensionId, 'extension', content)
  → IPC push: ipc:extension:chat-update { extensionId, message }
      │
      ▼
Renderer: ExtensionChatView appends new message
```

### 4.3  Extension Registers an AI Tool

```
extension calls ctx.tools.register({ name, description, schema, execute })
  │
  ▼
ToolCapabilityProvider
  → validates: name doesn't collide with existing tool
  → wraps execute() with error boundary + extensionId tag
  → IToolRegistry.registerTool(wrappedTool)
      │
      ▼
AI agent next invocation: tool appears in getToolDefinitions()
  → AI calls it like any built-in tool
```

### 4.4  Extension Install Flow

```
User drops my-ext.scext onto Extension Manager page
  → IPC: ipc:extension:install { scextPath }
      │
      ▼
IExtensionLoader.install(scextPath)
  → unzip to <userData>/extensions/<id>/
  → parse & validate manifest.json
  → check apiVersion compatibility
  → return ExtensionManifest
      │
      ▼
IExtensionHost.load(id)
  → IExtensionLoader.load(id) → require(entryPath) → ExtensionEntryFn
  → IExtensionCapabilityRegistry.buildContext(manifest) → ExtensionContext
  → call entryFn(ctx)  [extension's onActivate fires here]
  → IVirtualChatProvider.upsert(id, manifest)  [adds sidebar entry]
      │
      ▼
Renderer: Extension Manager shows new extension as enabled
Renderer: Sidebar shows new dedicated chat entry (if declared)
```

---

## 5  Bootstrapping Sequence (index.ts)

```ts
// index.ts — order matters for DIP compliance

// 1. Core services (unchanged)
const services = createServices(prisma, getMainWindow, getBus, getSock)

// 2. Infrastructure (depend only on service interfaces)
const eventBridge       = new ExtensionEventBridge(services.getBus)
const storageRepo       = new ExtensionStorageRepository(prisma)
const chatRepo          = new DedicatedChatRepository(prisma)
const schedulerService  = new ExtensionSchedulerService()
const virtualChatProv   = new VirtualChatProvider(services.chatRepository)
const sessionManager    = new DedicatedChatSessionManager(chatRepo, windowEmitter)

// 3. Capability Providers (depend on service interfaces, not ServiceContainer)
const registry = new ExtensionCapabilityRegistry()
registry.register('events',        new EventCapabilityProvider(eventBridge))
registry.register('storage',       new StorageCapabilityProvider(storageRepo))
registry.register('tools',         new ToolCapabilityProvider(services.toolRegistry))
registry.register('contacts',      new ContactsCapabilityProvider(services.contactService))
registry.register('chats',         new ChatsCapabilityProvider(services.chatService))
registry.register('scheduler',     new SchedulerCapabilityProvider(schedulerService))
registry.register('ui',            new UICapabilityProvider(services.notificationService, windowEmitter))
registry.register('dedicatedChat', new DedicatedChatCapabilityProvider(sessionManager, chatRepo, windowEmitter))
// log provider is built-in to registry — always injected
// No MessagingCapabilityProvider — sendMessage/messageAction/chatAction tools cover all mutations

// 4. Host (depends only on interfaces)
const extensionHost = new ExtensionHost(
  new ExtensionLoader(path.join(app.getPath('userData'), 'extensions')),
  registry,
  schedulerService,
  virtualChatProv,
  sessionManager
)

// 5. Load all installed extensions
extensionHost.loadAll()
// ServiceContainer never imports ExtensionHost — no circular dependency
```

---

## 6  Folder Structure

```
src/main/extensions/
├── host/
│   ├── IExtensionHost.ts
│   ├── ExtensionHost.ts
│   ├── IExtensionLoader.ts
│   └── ExtensionLoader.ts
│
├── capabilities/
│   ├── ICapabilityProvider.ts
│   ├── IExtensionCapabilityRegistry.ts
│   ├── ExtensionCapabilityRegistry.ts
│   └── providers/
│       ├── EventCapabilityProvider.ts
│       ├── StorageCapabilityProvider.ts
│       ├── ToolCapabilityProvider.ts
│       ├── ContactsCapabilityProvider.ts
│       ├── ChatsCapabilityProvider.ts      ← list() only
│       ├── SchedulerCapabilityProvider.ts
│       ├── UICapabilityProvider.ts
│       ├── DedicatedChatCapabilityProvider.ts
│       └── LogCapabilityProvider.ts
│
├── context/
│   ├── ExtensionContext.ts         ← the ctx type + all API interfaces
│   └── ExtensionEventMap.ts        ← ExtensionEventName + safe payload types
│
├── events/
│   ├── IExtensionEventBridge.ts
│   └── ExtensionEventBridge.ts
│
├── storage/
│   ├── IExtensionStorageRepository.ts
│   └── ExtensionStorageRepository.ts
│
├── dedicatedChat/
│   ├── IDedicatedChatRepository.ts
│   ├── DedicatedChatRepository.ts
│   ├── IDedicatedChatSessionManager.ts
│   └── DedicatedChatSessionManager.ts
│
├── scheduler/
│   ├── IExtensionSchedulerService.ts
│   └── ExtensionSchedulerService.ts
│
├── virtualChat/
│   ├── IVirtualChatProvider.ts
│   └── VirtualChatProvider.ts
│
└── types/
    ├── ExtensionManifest.ts
    └── ExtensionErrors.ts          ← ExtensionLoadError, PermissionError, etc.
```

---

## 7  SOLID Compliance Checklist

| Principle | How it's satisfied |
|---|---|
| **SRP** | `ExtensionLoader` only loads. `ExtensionHost` only manages lifecycle. Each `CapabilityProvider` owns exactly one API namespace. No provider duplicates tool functionality. |
| **OCP** | New `ctx` API = new `ICapabilityProvider` class + one `registry.register()` call. Nothing else modified. |
| **LSP** | All `ICapabilityProvider<T>` implementations are interchangeable. `ExtensionContext` properties are typed by interface, not concrete class. |
| **ISP** | `ctx` only contains the keys whose permission was declared. Unpermissioned APIs are `undefined` — not present at all. `IExtensionChatsAPI` is read-only; mutation concerns are fully in `IExtensionToolAPI`. |
| **DIP** | `ExtensionHost` depends on `IExtensionLoader`, `IExtensionCapabilityRegistry`, `IExtensionSchedulerService` — all interfaces. Each provider depends on a service interface, never `ServiceContainer`. No circular dependency. |
