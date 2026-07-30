# Phase 11c — Panel UI

## Goal

Render webview-based persistent panels for `sidebar-panel` and `settings-page` contributions.
Panels are opened in two ways:

1. **Declarative (user-driven):** user clicks a plugin's sidebar tab or navigates to its settings entry.
2. **Imperative (plugin-driven):** the plugin worker calls `ctx.ui.openPanel(id)` from any handler
   (e.g. when a message arrives, when a slash command runs, when an AI tool completes).

In both cases the host mounts a sandboxed `<webview>` pointing at the plugin's declared panel HTML.
The panel has **direct, full-duplex access to the kernel API** via a dedicated preload bridge —
it does not route through the plugin's worker thread.

> [!IMPORTANT]
> Read `docs/architecture/microkernel.md` fully before starting — specifically §1.3, §5
> (`SidebarPanelContribution`, `SettingsPageContribution`), and §11 (shared webview infrastructure).
>
> **Phase 11b (Webview Overlay API) must be complete first.** Phase 11c reuses:
> - `plugin://` Electron protocol (same file resolution)
> - `--wa-*` CSS token injection via `smartchat:init`
> - `partition="persist:plugin-[pluginId]"` isolated webview session pattern

---

## Key Architectural Decisions

### Panel talks directly to kernel (not through worker)

Panel API calls bypass the plugin worker thread entirely:

```
Panel HTML (webview)
  → window.__smartchat.api.chats.getList(0, 20)
  → panel-preload: ipcRenderer.invoke('kernel:panel:api', { panelId, type, payload })
  → main process: PanelAPIRouter looks up panelId → pluginId → validates permissions
  → KernelAPIRouter.handle(pluginId, type, payload)
  → response returned to panel
```

#### Rationale & Benefits
- **Performance & 60 FPS Responsiveness**: Eliminates double serialization and 4-6 thread hops per call.
- **Worker Independence**: If the plugin worker is performing heavy CPU tasks (e.g. audio transcription, AI embeddings, cron processing), the Panel UI remains 100% responsive.
- **Developer Experience**: Panel authors write straightforward async browser code directly against `window.__smartchat.api.*` without manual message proxying.
- **Security Parity**: Requests carry `panelId` mapped to `pluginId` in Main process and execute through the exact same capability check engine (`KernelAPIRouter`).

#### Trade-offs & Mitigations
1. **Trade-off**: Maintaining two bridge APIs (`WorkerPluginRuntime` for Node workers vs `panel-preload.ts` for browser webviews).
   - *Mitigation*: Both bridge implementations map 1-to-1 to identical `KernelAPIRouter` namespaces (`kernel:chats`, `kernel:messages`, `kernel:storage`, etc.), keeping backend handlers 100% DRY.
2. **Trade-off**: Worker thread and Panel webview do not share in-memory JS heap variables.
   - *Mitigation*: Panels and workers synchronize state cleanly using persistent kernel storage (`ctx.storage` / `window.__smartchat.api.storage`) and pub-sub event subscriptions (`ctx.events` / `window.__smartchat.api.events`).

### Panels render in the full main stage (right of Nav Rail)

Panels declared under `sidebarPanels` in `manifest.json` render in the **main stage** to the right of the Nav Rail, occupying the full screen area.

Panels are opened in two ways:
1. **Declarative (user-driven):** user clicks a plugin's nav rail icon.
2. **Imperative (plugin-driven):** the plugin worker calls `ctx.ui.openPanel(id)` / `ctx.ui.closePanel(id)` from any handler (e.g. when an event arrives or slash command executes).

```typescript
// Opens / focuses the plugin's panel in the main stage
await ctx.ui.openPanel('my-panel-id')

// Closes / returns to default chat view
await ctx.ui.closePanel('my-panel-id')
```

Requires `ui:panel` capability. Opening a panel switches the active main stage view to the plugin's persistent `<PanelWebview>`. Moving away or closing returns to the standard Chat view.

---

## Proposed Changes

### Main Process — Panel Infrastructure

#### [NEW] `src/main/kernel/ui/IPanelHost.ts`

```typescript
export interface PanelDescriptor {
  panelId: string        // UUID assigned by kernel
  contributionId: string // the `id` field from the contribution
  pluginId: string
  panelPath: string      // resolved path inside .scext
  type: 'sidebar' | 'settings'
}

export interface IPanelHost {
  /** Register a panel when its contribution is loaded. Returns assigned panelId. */
  registerPanel(desc: Omit<PanelDescriptor, 'panelId'>): string
  /** Look up a panel by pluginId + contributionId (for imperative open/close). */
  findPanel(pluginId: string, contributionId: string): PanelDescriptor | undefined
  /** Deregister all panels for a plugin (called on plugin unload). */
  deregisterPlugin(pluginId: string): void
  /** Look up pluginId for an active panel (for permission attribution). */
  getPluginId(panelId: string): string | undefined
}
```

#### [NEW] `src/main/kernel/ui/PanelHost.ts`

Concrete implementation. Maintains an in-memory `Map<panelId, PanelDescriptor>`. Generates UUIDs.
No BrowserWindow interaction — the renderer owns the webview lifecycle.

#### [MODIFY] [KernelBootstrapper.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/KernelBootstrapper.ts)

- Instantiate `PanelHost` and pass to `KernelUIModule`.
- When `ContributionRegistry.onChange()` fires, scan `sidebar-panel` and `settings-page` slots
  and call `panelHost.registerPanel(...)` for any new contributions. On plugin unload,
  call `panelHost.deregisterPlugin(pluginId)`.
- Register the `kernel:panel:api` IPC handler (see below).

#### [MODIFY] [KernelUIModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelUIModule.ts)

Add two new actions under the `kernel:ui` namespace for imperative panel control:

- **`openPanel`**: Requires `ui:panel` capability. Looks up the panel by `contributionId` via
  `panelHost.findPanel(pluginId, contributionId)`. Sends IPC to renderer:
  `webContents.send('kernel:ui:panel:open', { panelId, contributionId, pluginId })`. Resolves void.
- **`closePanel`**: Requires `ui:panel` capability. Sends IPC to renderer:
  `webContents.send('kernel:ui:panel:close', { contributionId })`. Resolves void.

All other panel API calls go through `kernel:panel:api` directly (not via `KernelUIModule`).

---

### Main Process — Panel API IPC Handler

#### [NEW] `src/main/kernel/ipc/panelIpc.ts`

This is the single IPC endpoint that all panel webviews call for kernel API access.

```typescript
// Handles direct kernel API calls FROM panel webviews
ipcMain.handle('kernel:panel:api', async (event, { panelId, type, payload }) => {
  // 1. Look up pluginId from panelId (validate the call is from a legitimate panel)
  const pluginId = panelHost.getPluginId(panelId)
  if (!pluginId) return { ok: false, error: { code: 'PANEL_NOT_FOUND' } }

  // 2. Route through the normal KernelAPIRouter with the panel's pluginId
  //    Permissions are checked exactly as they are for worker-thread plugins
  try {
    const result = await kernelAPIRouter.handle(pluginId, type, payload)
    return { ok: true, payload: result }
  } catch (err) {
    return { ok: false, error: serializeError(err) }
  }
})

// Handles event subscription requests from panels
ipcMain.handle('kernel:panel:events:subscribe', async (event, { panelId, eventName }) => {
  const pluginId = panelHost.getPluginId(panelId)
  if (!pluginId) return { ok: false }
  // Register a one-time or persistent subscription that pushes events back to the webview
  // via event.sender.send('smartchat:event', { event: eventName, payload })
  const unsubscribe = waEventBus.on(eventName, (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('smartchat:event', { event: eventName, payload })
    }
  })
  // Store unsubscribe fn keyed by panelId+eventName for cleanup on panel close
  panelSubscriptions.set(`${panelId}:${eventName}`, unsubscribe)
  return { ok: true }
})

ipcMain.on('kernel:panel:events:unsubscribe', (event, { panelId, eventName }) => {
  panelSubscriptions.get(`${panelId}:${eventName}`)?.()
  panelSubscriptions.delete(`${panelId}:${eventName}`)
})

ipcMain.on('kernel:panel:closed', (_, { panelId }) => {
  // Clean up all subscriptions for this panel
  for (const [key, unsub] of panelSubscriptions) {
    if (key.startsWith(panelId)) { unsub(); panelSubscriptions.delete(key) }
  }
})
```

---

### Panel Preload Script

#### [NEW] `src/renderer/panel-preload.ts`

This is the **full kernel API bridge** exposed to panel HTML. It is injected by the host — plugins
cannot override or replace it. Built as a separate compiled artifact (similar to `overlay-preload.ts`).

```typescript
// src/renderer/panel-preload.ts
import { contextBridge, ipcRenderer } from 'electron'

// Assigned by the host via smartchat:init before any user code runs
let panelId: string = ''

function request<T>(type: string, payload: unknown): Promise<T> {
  return ipcRenderer.invoke('kernel:panel:api', { panelId, type, payload })
    .then(res => {
      if (!res.ok) throw Object.assign(new Error(res.error?.message ?? type), res.error)
      return res.payload as T
    })
}

contextBridge.exposeInMainWorld('__smartchat', {
  // Called by host on dom-ready. Sets panelId and applies design tokens.
  _init(id: string, tokens: Record<string, string>) {
    panelId = id
    const style = document.createElement('style')
    style.textContent = `:root { ${Object.entries(tokens).map(([k,v]) => `${k}:${v}`).join(';')} }`
    document.head.appendChild(style)
  },

  api: {
    chats: {
      getList:           (page, limit) => request('kernel:chats:getList', { page, limit }),
      getById:           (jid)         => request('kernel:chats:getById', { jid }),
      pin:               (jid)         => request('kernel:chats:pin', { jid }),
      unpin:             (jid)         => request('kernel:chats:unpin', { jid }),
      archive:           (jid)         => request('kernel:chats:archive', { jid }),
      unarchive:         (jid)         => request('kernel:chats:unarchive', { jid }),
      mute:              (jid, ms)     => request('kernel:chats:mute', { jid, durationMs: ms }),
      unmute:            (jid)         => request('kernel:chats:unmute', { jid }),
      markRead:          (jid)         => request('kernel:chats:markRead', { jid }),
    },
    messages: {
      getMessages:       (jid, p, l)   => request('kernel:messages:getMessages', { jid, page: p, limit: l }),
      send:              (jid, text)   => request('kernel:messages:send', { jid, text }),
      delete:            (jid, id)     => request('kernel:messages:delete', { jid, messageId: id }),
      react:             (jid, id, e)  => request('kernel:messages:react', { jid, messageId: id, emoji: e }),
    },
    contacts: {
      getByJid:          (jid)         => request('kernel:contacts:getByJid', { jid }),
      getMe:             ()            => request('kernel:contacts:getMe', {}),
    },
    storage: {
      get:               (key)         => request('kernel:storage:get', { key }),
      set:               (key, val)    => request('kernel:storage:set', { key, value: val }),
      delete:            (key)         => request('kernel:storage:delete', { key }),
      keys:              ()            => request('kernel:storage:keys', {}),
    },
    ai: {
      chat:              (prompt, opts) => request('kernel:ai:chat', { prompt, options: opts }),
      getAvailableModels: ()           => request('kernel:ai:getAvailableModels', {}),
    },
    events: {
      on(event: string, handler: (payload: unknown) => void): () => void {
        ipcRenderer.invoke('kernel:panel:events:subscribe', { panelId, eventName: event })
        const listener = (_: unknown, msg: { event: string; payload: unknown }) => {
          if (msg.event === event) handler(msg.payload)
        }
        ipcRenderer.on('smartchat:event', listener)
        return () => {
          ipcRenderer.invoke('kernel:panel:events:unsubscribe', { panelId, eventName: event })
          ipcRenderer.removeListener('smartchat:event', listener)
        }
      }
    },
    log: {
      info:  (msg, ...d) => request('kernel:log:info',  { msg, data: d }),
      warn:  (msg, ...d) => request('kernel:log:warn',  { msg, data: d }),
      error: (msg, ...d) => request('kernel:log:error', { msg, data: d }),
    },
  },
})

// Notify host when panel is closed/navigated away
window.addEventListener('unload', () => {
  ipcRenderer.send('kernel:panel:closed', { panelId })
})
```

---

### Preload Bridge — `src/preload/`

#### [MODIFY] `api.service.ts` and `IAPIService.ts`

Add panel lifecycle signals pushed from main to renderer:

```typescript
// Main pushes when contribution registry updates — renderer re-renders sidebar tabs
onPanelContributionsUpdated(handler: (panels: SidebarPanelContribution[]) => void): () => void

// Main pushes when plugin calls ctx.ui.openPanel() / closePanel()
onPanelFocusRequest(handler: (req: { action: 'open' | 'close'; contributionId: string }) => void): () => void

// Renderer notifies main when a panel webview is destroyed (for subscription cleanup)
notifyPanelClosed(panelId: string): void
```

---

### Renderer — Sidebar Integration

#### [NEW] `src/renderer/src/components/panels/PanelWebview.tsx`

The reusable webview wrapper for both sidebar panels and settings panels.

```tsx
// Props
interface PanelWebviewProps {
  panelId: string
  pluginId: string
  panelUrl: string   // plugin://[pluginId]/[panel path]
  visible: boolean   // sidebar: toggled; settings: always true while mounted
}
```

Responsibilities:
- Renders `<webview src={panelUrl} preload={PANEL_PRELOAD_PATH} partition={`persist:plugin-${pluginId}`} />`
- On `dom-ready`: reads all `--wa-*` vars from `:root`, calls `webview.executeJavaScript` to invoke `window.__smartchat._init(panelId, tokens)`
- CSS: `display: none` when `visible=false` — keeps webview alive without destroying it
- On unmount: sends `kernel:panel:closed` via `window.api.notifyPanelClosed(panelId)`

#### [NEW] `src/renderer/src/components/panels/SidebarPluginTabs.tsx`

Rendered inside the existing sidebar. Reads `useContributions('sidebar-panel')` and renders a tab
button for each (using `PluginIcon` for the icon, already implemented). On tab select, sets active
panel state. Renders the corresponding `<PanelWebview>` for each panel (all mounted, only the
active one visible — preserves webview state on tab switch).

Also listens to `window.api.onPanelFocusRequest()` to handle **imperative** open/close from the
plugin worker:

```tsx
const panels = useContributions('sidebar-panel')
const [activeId, setActiveId] = useState<string | null>(null)

useEffect(() => {
  return window.api.onPanelFocusRequest(({ action, contributionId }) => {
    if (action === 'open')  setActiveId(contributionId)
    if (action === 'close' && activeId === contributionId) setActiveId(null)
  })
}, [activeId])

return (
  <>
    {panels.map(p => (
      <SidebarTabButton key={p.id} contribution={p} active={p.id === activeId}
        onClick={() => setActiveId(p.id)} />
    ))}
    {panels.map(p => (
      <PanelWebview key={p.id} panelId={resolvedPanelId(p)} pluginId={p.pluginId}
        panelUrl={`plugin://${p.pluginId}/${p.panel}`}
        visible={p.id === activeId} />
    ))}
  </>
)
```

#### [MODIFY] Existing sidebar component (discovered at implementation time)

Integrate `<SidebarPluginTabs>` into the sidebar layout. Plugin tabs appear below the existing
built-in icons (chats, status, etc.).

---

### Renderer — Settings Integration

#### [NEW] `src/renderer/src/components/panels/SettingsPluginPage.tsx`

Rendered when the user navigates to a plugin's settings entry. Unlike sidebar panels (kept alive),
settings panels are **created fresh** each visit and destroyed on navigate-away — they are visited
infrequently and keeping them alive would waste memory.

```tsx
// Mounts on route: /settings/plugins/[pluginId]/[panelId]
const { pluginId, panelId } = useParams()
const panels = useContributions('settings-page')
const panel = panels.find(p => p.pluginId === pluginId && p.id === panelId)

if (!panel?.panel) return <div>No settings page for this plugin.</div>

return (
  <PanelWebview panelId={resolvedPanelId(panel)} pluginId={pluginId}
    panelUrl={`plugin://${pluginId}/${panel.panel}`}
    visible={true} />
)
```

#### [MODIFY] Settings page router (discovered at implementation time)

Add plugin settings entries to the settings sidebar list from `useContributions('settings-page')`.
Each entry navigates to `SettingsPluginPage`.

---

### `panelId` Resolution

The `panelId` is a kernel-assigned UUID, not the contribution `id`. The renderer needs to know
the `panelId` for each contribution to pass to `PanelWebview` and the preload.

Resolution: during `ContributionRegistry.onChange()`, `KernelBootstrapper` calls
`panelHost.registerPanel(...)` for each new panel contribution. A snapshot including `panelId`
is pushed to the renderer alongside the contributions snapshot:

```typescript
// Pushed to renderer alongside contributions:
{ slot: 'sidebar-panel', contributions: [...], panelIds: Record<contributionId, panelId> }
```

The renderer stores this mapping in `ContributionContext` and the `SidebarPluginTabs` /
`SettingsPluginPage` components use it to resolve `panelId` from a contribution.

---

## Verification Plan

### Automated Tests

```bash
# PanelHost registration and deregistration
npm run test:run -- src/main/tests/kernel/ui/PanelHost.test.ts

# panelIpc routing and permission attribution
npm run test:run -- src/main/tests/kernel/ipc/panelIpc.test.ts

# Full regression
npm run test:run

npm run typecheck
npm run test:rebuild:electron
```

### Manual Verification

1. Install a test `.scext` plugin that declares a `sidebarPanel` with `panel: "panels/sidebar.html"`. Verify:
   - Plugin's tab icon appears in sidebar
   - Clicking it mounts the webview with correct `plugin://` URL
   - `--wa-*` tokens applied — UI matches dark theme
   - `window.__smartchat.api.chats.getList(0, 10)` returns real chat data from the panel JS console

2. Test event subscription from panel:
   - Panel calls `window.__smartchat.api.events.on('message:incoming', handler)`
   - Send a WhatsApp message to a connected account
   - Verify `handler` fires in the panel with the correct payload

3. Test tab switching: open panel A, type something in a text input, switch to another tab,
   switch back — verify the input value is preserved (webview kept alive, not remounted).

4. Install a plugin with a `settingsPage`. Navigate to Settings → [plugin name]. Verify the
   panel HTML loads and `window.__smartchat.api.storage.get('myKey')` works.

5. Uninstall the plugin. Verify sidebar tab and settings entry disappear, and no zombie subscriptions
   remain (no errors in console when events fire).

---

## Acceptance Criteria

- [ ] `plugin://` protocol resolves `sidebar-panel` and `settings-page` HTML correctly (shared with 11b)
- [ ] `panel-preload.ts` compiled and injected into panel webviews
- [ ] `window.__smartchat._init(panelId, tokens)` called on `dom-ready` — tokens applied, panelId set
- [ ] `window.__smartchat.api.*` covers: `chats`, `messages`, `contacts`, `storage`, `ai`, `events`, `log`
- [ ] All panel API calls validated against plugin permissions via `panelHost.getPluginId(panelId)`
- [ ] Sidebar tabs rendered for all `sidebar-panel` contributions via `useContributions()`
- [ ] Sidebar panels kept alive on tab switch (`display: none`, not unmounted)
- [ ] Settings entries rendered for all `settings-page` contributions
- [ ] Settings panels created fresh per visit (destroyed on navigate-away)
- [ ] Event subscriptions cleaned up on panel close (`kernel:panel:closed`)
- [ ] Plugin unload deregisters all its panels from `PanelHost`
- [ ] `panelId` mapping included in contributions snapshot pushed to renderer
- [ ] `ctx.ui.openPanel(contributionId)` imperatively focuses the sidebar panel (requires `ui:panel`)
- [ ] `ctx.ui.closePanel(contributionId)` hides the active panel
- [ ] `onPanelFocusRequest` IPC signal reaches renderer and updates active tab state
- [ ] Imperative open works from within a `messageAction`, `chatAction`, and `slashCommand` handler
- [ ] Zero TypeScript errors (`npm run typecheck`)
- [ ] All existing tests pass
