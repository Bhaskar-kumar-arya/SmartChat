# SmartChat Extension System — Phase-wise Build Plan

> Ordered by dependency graph. Each phase ends with a concrete testable checkpoint before moving on.

---

## Dependency Graph (summary)

```
Phase 1: Types + Prisma + Loader     (no extension deps)
  └─► Phase 2: Registry + Storage + Host skeleton
        └─► Phase 3: Events (ExtensionEventBridge)
        └─► Phase 4: Scheduler
        └─► Phase 5: Tool Integration
        └─► Phase 6: Contacts & Chats
        └─► Phase 7: UI / Notifications
              └─► Phase 8: Dedicated Chat (all ctx APIs assembled)
                    └─► Phase 9: Renderer (Extension Manager + Chat UI)
                          └─► Phase 10: Dev Tooling (CLI + type defs)
```

Phases 3–7 can be built in any order after Phase 2. Phase 8 needs them all.

---

## Phase 1 — Foundation: Types, Prisma, Loader

**Goal:** The bare minimum needed to load any extension from disk.

### Files to create

```
src/main/extensions/
  types/
    ExtensionManifest.ts     ← manifest interface + SlashCommand, CronEntry types
    ExtensionErrors.ts       ← ExtensionLoadError, ManifestValidationError, ApiVersionError
  host/
    IExtensionLoader.ts
    ExtensionLoader.ts
```

### What `ExtensionLoader` does
- `install(scextPath)` — unzip `.scext` into `<userData>/extensions/<id>/`, return parsed manifest
- `load(id)` — `require()` the entry point, validate it's a function or `{ activate }` shape
- `reload(id)` — clear `require.cache` for all files in extension dir, then `load()`
- `uninstall(id)` — delete the directory
- `listInstalled()` — read all subdirectories, parse their `manifest.json` files
- Validates `apiVersion` against a `SUPPORTED_API_VERSIONS` constant

### Prisma additions

```prisma
model Extension {
  id          String   @id          // matches manifest.id
  name        String
  version     String
  enabled     Boolean  @default(true)
  installedAt DateTime @default(now())
}

model ExtensionKV {
  extensionId String
  key         String
  value       String                // JSON-serialised
  updatedAt   DateTime @updatedAt
  @@id([extensionId, key])
}
```

### ✅ Testable checkpoint
Write a minimal `.scext` (just zip a `manifest.json` + `index.js` that does `module.exports = async function(){}`).
```ts
const loader = new ExtensionLoader(tmpDir)
const manifest = await loader.install('./test.scext')
expect(manifest.id).toBe('test-ext')
const mod = await loader.load('test-ext')
expect(typeof mod === 'function' || typeof mod.activate === 'function').toBe(true)
```

---

## Phase 2 — Registry, Storage & Host Skeleton

**Goal:** Be able to activate an extension with `ctx.log` and `ctx.storage` working.

**Depends on:** Phase 1

### Files to create

```
src/main/extensions/
  capabilities/
    ICapabilityProvider.ts
    IExtensionCapabilityRegistry.ts
    ExtensionCapabilityRegistry.ts
    providers/
      LogCapabilityProvider.ts       ← always injected, writes to <userData>/extensions/<id>/ext.log
      StorageCapabilityProvider.ts   ← wraps IExtensionStorageRepository
  context/
    ExtensionContext.ts              ← full ctx interface (all optional fields defined here)
  storage/
    IExtensionStorageRepository.ts
    ExtensionStorageRepository.ts    ← Prisma CRUD on ExtensionKV
  host/
    IExtensionHost.ts
    ExtensionHost.ts                 ← loadAll / load / unload / reload lifecycle
```

### Wire into bootstrapping
```ts
// index.ts (minimal wiring for this phase)
const storageRepo = new ExtensionStorageRepository(prisma)
const registry    = new ExtensionCapabilityRegistry()
// Log provider is always registered internally by registry
registry.register('storage', new StorageCapabilityProvider(storageRepo))

const host = new ExtensionHost(
  new ExtensionLoader(extensionsPath),
  registry,
  schedulerService,   // stub/null for now
  virtualChatProv     // stub/null for now
)
host.loadAll()
```

### ✅ Testable checkpoint
Write a test extension:
```js
// index.js
module.exports = async function(ctx) {
  ctx.log.info('Extension activated')
  ctx.onActivate(async () => {
    await ctx.storage.set('boot_count', (await ctx.storage.get('boot_count') ?? 0) + 1)
    ctx.log.info('Boot count:', await ctx.storage.get('boot_count'))
  })
}
```
Install it, restart the app twice, verify `boot_count` increments and log file is written.

---

## Phase 3 — Event Bridge

**Goal:** Extensions can subscribe to real-time WhatsApp events with sanitised payloads.

**Depends on:** Phase 2

### Files to create

```
src/main/extensions/
  context/
    ExtensionEventMap.ts         ← ExtensionEventName union + per-event safe payload types
  events/
    IExtensionEventBridge.ts
    ExtensionEventBridge.ts
  capabilities/providers/
    EventCapabilityProvider.ts
```

### Key implementation detail in `ExtensionEventBridge`
```ts
// Subscribe to raw WAEventBus
bus.on('message:incoming', (raw) => {
  const safe = {
    chatJid:     raw.processed.chatJid,
    senderJid:   raw.senderJid,
    textContent: raw.processed.textContent,
    fromMe:      raw.processed.fromMe,
    timestamp:   raw.processed.timestamp,
    enriched:    raw.enriched,
    // sock, processed.rawBaileys, processed itself → NOT forwarded
  }
  this.emit('message:incoming', extensionId, safe)
})
```

Register into registry, wire into host.

### ✅ Testable checkpoint
```js
// test extension
module.exports = async function(ctx) {
  ctx.onActivate(async () => {
    ctx.events.on('message:incoming', (msg) => {
      ctx.log.info('Got message from', msg.senderJid)
      // Verify: msg has no .sock, no .processed
    })
  })
}
```
Send yourself a WhatsApp message. Verify log fires. Verify `msg.sock` is `undefined`.

---

## Phase 4 — Scheduler

**Goal:** Extensions can schedule recurring tasks and one-shot timers.

**Depends on:** Phase 2

### Files to create

```
src/main/extensions/
  scheduler/
    IExtensionSchedulerService.ts
    ExtensionSchedulerService.ts
  capabilities/providers/
    SchedulerCapabilityProvider.ts
```

### Key implementation detail
`ExtensionSchedulerService` stores all handles in a `Map<extensionId, (cancel: () => void)[]>`. On `cancelAll(id)` it cancels everything. `ExtensionHost.unload()` calls `cancelAll()`.

### ✅ Testable checkpoint
```js
module.exports = async function(ctx) {
  ctx.onActivate(async () => {
    ctx.scheduler.setInterval(3000, () => ctx.log.info('tick'))
    ctx.scheduler.onCron('morning', () => ctx.log.info('good morning'))
  })
}
```
Verify `tick` appears every 3 seconds. Disable the extension. Verify `tick` stops. Re-enable. Verify `tick` resumes.

---

## Phase 5 — Tool Integration

**Goal:** Extensions can call all existing AI tools and register new ones.

**Depends on:** Phase 2

### Files to create

```
src/main/extensions/
  capabilities/providers/
    ToolCapabilityProvider.ts    ← builds IExtensionToolCallAPI and/or IExtensionToolRegisterAPI
```

### Key implementation details
- `tools:read` permission → gives `call()` and `list()`
- `tools:register` permission → gives `register()` and `list()`
- `register()` must check for name collisions with existing tools before calling `IToolRegistry.registerTool()`
- Wrap the extension's `execute()` in a try/catch that logs to `ctx.log.error` on failure

### ✅ Testable checkpoint — two scenarios

**Scenario A: call a built-in tool**
```js
// permissions: ['tools:read']
ctx.onActivate(async () => {
  const result = await ctx.tools.call('readMessages', { chatJid: '...' })
  ctx.log.info(result.text)
})
```

**Scenario B: register a custom tool**
```js
// permissions: ['tools:register']
ctx.onActivate(async () => {
  ctx.tools.register({
    name: 'getTime',
    description: 'Returns the current time',
    schema: { type: 'object', properties: {}, required: [] },
    execute: async () => ({ text: new Date().toISOString() })
  })
})
```
Open the AI chat, ask "what time is it?". The AI should use `getTime`.

---

## Phase 6 — Contacts & Chats

**Goal:** Extensions can resolve names and query the chat list.

**Depends on:** Phase 2

### Files to create

```
src/main/extensions/
  capabilities/providers/
    ContactsCapabilityProvider.ts   ← wraps IContactService
    ChatsCapabilityProvider.ts      ← wraps IChatService.list()
```

### ✅ Testable checkpoint
```js
// permissions: ['contacts:read', 'chats:read']
ctx.onActivate(async () => {
  const selfJid = await ctx.contacts.getSelfJid()
  ctx.log.info('I am', selfJid)

  const chats = await ctx.chats.list(5)
  ctx.log.info('Top 5 chats:', chats.map(c => c.name).join(', '))
})
```
Verify output in extension log.

---

## Phase 7 — UI / Notifications

**Goal:** Extensions can send OS notifications and toast banners.

**Depends on:** Phase 2

### Files to create

```
src/main/extensions/
  capabilities/providers/
    UICapabilityProvider.ts
```

Delegates to `INotificationService.send()` for OS notifications, emits `ipc:ui:toast` for banners.

### ✅ Testable checkpoint
```js
// permissions: ['ui:notification']
ctx.onActivate(async () => {
  ctx.scheduler.setTimeout(2000, async () => {
    await ctx.ui.notify({ title: 'Test', body: 'Extension loaded!' })
    ctx.ui.toast('Hello from extension', 'success')
  })
})
```
Verify OS notification appears after 2 seconds. Verify green toast banner in the app.

---

## Phase 8 — Dedicated Chat

**Goal:** Extensions have their own local bot chat in the sidebar.

**Depends on:** Phases 2–7 (all ctx APIs must be in place first)

### This is the most complex phase. Build in this sub-order:

#### 8a — Prisma + Domain type change
```prisma
model ExtensionChatMessage {
  id          String   @id @default(cuid())
  extensionId String
  role        String   // 'user' | 'extension'
  content     String   // JSON: { type, text, card, buttons }
  createdAt   DateTime @default(now())
}
```

Modify `chatList.types.ts`:
```ts
// Add to existing ChatListEntry:
source?:     'whatsapp' | 'extension'
extensionId?: string
```

#### 8b — Infrastructure
```
src/main/extensions/
  dedicatedChat/
    IDedicatedChatRepository.ts
    DedicatedChatRepository.ts
    IDedicatedChatSessionManager.ts
    DedicatedChatSessionManager.ts
  virtualChat/
    IVirtualChatProvider.ts
    VirtualChatProvider.ts         ← writes ChatListEntry{ source:'extension' } rows
```

#### 8c — Capability Provider
```
capabilities/providers/
  DedicatedChatCapabilityProvider.ts
```

#### 8d — IPC channels (main process side)
```
ipc:extension:chat-send    { extensionId, text }         → DedicatedChatSessionManager.routeUserMessage()
ipc:extension:chat-push    { extensionId, message }      → renderer (push from main)
ipc:extension:chat-history { extensionId, limit }        → DedicatedChatRepository.getHistory()
ipc:extension:list                                        → host.listLoaded() + manifests
```

### ✅ Testable checkpoint (no renderer yet — use IPC directly from devtools)
```js
// permissions: ['ui:dedicated_chat']
ctx.onActivate(async () => {
  ctx.events.on('extension:chat-message', async ({ text }) => {
    if (text === '/ping') {
      await ctx.dedicatedChat.send({ type: 'text', text: 'pong!' })
    } else {
      await ctx.dedicatedChat.send({
        type: 'card',
        title: 'Echo',
        body: text,
        buttons: [{ id: 'ok', label: '👍 OK' }]
      })
    }
  })
})
```
Invoke `ipc:extension:chat-send` from devtools. Verify response arrives on `ipc:extension:chat-push`.

---

## Phase 9 — Renderer: Extension Manager + Chat UI

**Goal:** Users can install, enable/disable extensions and use dedicated chats from the UI.

**Depends on:** Phase 8 (all IPC channels must exist)

### Components to build

```
src/renderer/
  pages/
    ExtensionManager/
      ExtensionManager.tsx         ← list of installed extensions, enable/disable toggle
      ExtensionCard.tsx            ← per-extension card with name, version, permissions
      ExtensionLogViewer.tsx       ← tail of <userData>/extensions/<id>/ext.log
  components/
    ExtensionChatView/
      ExtensionChatView.tsx        ← renders DedicatedChatMessage list (text, cards, buttons)
      ExtensionChatInput.tsx       ← slash-command autocomplete + text input
```

### Sidebar changes
- Extend `ChatListItem` to render `source: 'extension'` entries with emoji avatar from manifest
- Route `onClick` to `ExtensionChatView` instead of WhatsApp chat view

### ✅ Testable checkpoint
- Open Extension Manager → install `test-ext.scext` → it appears enabled
- Extension's sidebar chat entry appears
- Type `/ping` → receive `pong!` 
- Type anything → receive echo card with 👍 button
- Toggle extension off → chat entry disappears from sidebar
- Toggle back on → chat entry reappears, history preserved

---

## Phase 10 — Developer Tooling

**Goal:** Extension authors have a smooth development loop.

**Depends on:** Phase 9 (full system must work end-to-end first)

### `@smartchat/extension-api` npm package

```
packages/extension-api/
  index.d.ts      ← all interfaces from §3 of the architecture doc (types only, not bundled)
  package.json    ← { "name": "@smartchat/extension-api", "types": "index.d.ts" }
```

### `smartchat-ext` CLI

```
packages/smartchat-ext-cli/
  src/
    commands/
      create.ts    ← scaffold template extension into new folder
      pack.ts      ← npm install + zip into .scext
      install.ts   ← call ipc:extension:install on running app (via electron IPC or HTTP)
      dev.ts       ← file watcher → auto reload:extension IPC on save
```

#### `create` scaffold template
```
my-extension/
  manifest.json     ← pre-filled with placeholder id/name/apiVersion
  index.js          ← hello-world with ctx.log.info
  package.json
  .gitignore        ← node_modules/
```

### ✅ Testable checkpoint (full dev loop)
```bash
npx smartchat-ext create my-extension
cd my-extension
# edit index.js
npx smartchat-ext pack               # → dist/my-extension.scext
npx smartchat-ext install dist/my-extension.scext
# Extension appears in running SmartChat
# Edit index.js, save →  smartchat-ext dev auto-reloads it
```

---

## Build Order Summary

| Phase | Deliverable | Depends on | Test signal |
|---|---|---|---|
| **1** | Types, Loader, Prisma (Extension + ExtensionKV) | — | Unit test: install + load a .scext |
| **2** | Registry, Storage, Host skeleton, `ctx.log`, `ctx.storage` | 1 | Extension persists a counter across restarts |
| **3** | EventBridge, `ctx.events` | 2 | Extension logs incoming WhatsApp messages, no `sock` in payload |
| **4** | SchedulerService, `ctx.scheduler` | 2 | Interval ticks, stops on disable |
| **5** | ToolProvider, `ctx.tools` | 2 | Call `readMessages`; register `getTime` for AI |
| **6** | ContactsProvider, ChatsProvider | 2 | Extension logs self JID and top 5 chats |
| **7** | UIProvider, `ctx.ui` | 2 | OS notification + toast appear |
| **8** | Dedicated chat (Prisma, infra, IPC, provider) | 2–7 | `/ping` → `pong!` via IPC devtools |
| **9** | Renderer: Extension Manager + Chat UI | 8 | Full UI loop: install, chat, toggle |
| **10** | CLI + type defs package | 9 | `create` → `pack` → `install` → `dev` loop |

> **Note:** Phases 3–7 are independent of each other. Build them in any order. Each one just adds one `registry.register(...)` call to the bootstrapper.
