# Phase 11b — Webview Overlay API

## Goal

Implement `ctx.ui.showOverlay()` — the Tier 2 overlay mechanism that renders a plugin's custom HTML inside a sandboxed Electron `<webview>`. Supports two interaction models:

- **Model A (Promise)**: overlay collects input, calls `window.__smartchat.submit(data)`, plugin awaits the resolved value.
- **Model B (Handle)**: overlay stays open; full bidirectional event stream via `overlay.on()` / `overlay.send()` / `overlay.close()`.

Design tokens (`--wa-*`) are injected into every webview automatically on load.

> [!IMPORTANT]
> Read `docs/architecture/microkernel.md` fully before starting — specifically §1.9, §6 (`IPluginUIAPI`, `OverlayOptions`, `PluginOverlayHandle`), §11.1–§11.6. This is the ground truth.
>
> Phase 11a (Declarative Modal API) must be complete before starting this phase. The `IOverlayHost` and IPC plumbing introduced in 11a is extended here.

---

## Proposed Changes

### Renderer — Custom Protocol Handler

#### [NEW] `src/main/protocol/pluginProtocol.ts`

Register a `plugin://` protocol with Electron so that `<webview src="plugin://com.acme.translate/overlays/translate.html">` resolves to the correct file inside the installed `.scext` extracted directory.

```typescript
protocol.registerFileProtocol('plugin', (request, callback) => {
  // parse plugin://[pluginId]/[relPath]
  // resolve to: userData/extensions/[pluginId]/[relPath]
  callback({ path: resolvedPath })
})
```

This must be registered in `src/main/index.ts` / `KernelBootstrapper` before any window is created.

#### [MODIFY] [KernelBootstrapper.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/KernelBootstrapper.ts)

Register `plugin://` protocol at boot time (before `BrowserWindow` creation).

---

### Overlay Preload Script

#### [NEW] `src/renderer/overlay-preload.js` (or `.ts` compiled to `.js`)

This file is injected by the host into every overlay `<webview>` via the `preload` attribute. Plugins cannot override or replace it.

```typescript
// src/renderer/overlay-preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('__smartchat', {
  submit:  (data: unknown)         => ipcRenderer.sendToHost('smartchat:submit', data),
  emit:    (event: string, data: unknown) => ipcRenderer.sendToHost('smartchat:event', { event, data }),
  dismiss: ()                      => ipcRenderer.sendToHost('smartchat:dismiss'),
  // `receive` is patched by OverlayShell after dom-ready so overlay.send() reaches the panel
  receive: null as ((event: string, data: unknown) => void) | null,
})
```

Build this as a separate compiled artifact. Reference its built path in `<webview preload="...">`.

---

### SDK — `packages/sdk/`

#### [MODIFY] [context.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/context.ts)

Add to `IPluginUIAPI`:
```typescript
showOverlay(opts: OverlayOptions & { mode?: 'promise' }): Promise<unknown | null>
showOverlay(opts: OverlayOptions & { mode: 'handle' }): Promise<PluginOverlayHandle>
```

Add exported interfaces `OverlayOptions` and `PluginOverlayHandle` (already specified in §6 of microkernel.md).

#### [NEW] `packages/sdk/src/overlay.ts`

SDK helper for use inside overlay HTML files:

```typescript
/**
 * Injects all --wa-* design tokens as a <style> block on :root.
 * Call this inside the smartchat:init message handler.
 */
export function applyTokens(tokens: Record<string, string>): void {
  const style = document.createElement('style')
  const vars = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')
  style.textContent = `:root {\n${vars}\n}`
  document.head.appendChild(style)
}
```

Export from `packages/sdk/src/index.ts` under `@smartchat/sdk/overlay`.

#### [MODIFY] [channel.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/channel.ts)

Wire `showOverlay` in `WorkerPluginRuntime`:

```typescript
showOverlay: (opts) => {
  if (opts.mode === 'handle') {
    return this.requestOverlayHandle(opts)  // returns PluginOverlayHandle
  }
  return this.request('kernel:ui:showOverlay', opts)  // returns Promise<unknown|null>
}
```

`requestOverlayHandle`:
- Sends `kernel:ui:showOverlay` with `mode: 'handle'` to get back `overlayId`
- Constructs a `PluginOverlayHandle` object:
  - `on(event, handler)` — registers local listener keyed by `overlayId + event`
  - `send(event, data)` — postMessages `kernel:ui:overlay:send { overlayId, event, data }` to kernel
  - `close()` — postMessages `kernel:ui:overlay:close { overlayId }` to kernel
- Listens for incoming `kernel:ui:overlay:event` messages and dispatches to registered handlers

---

### Kernel — `src/main/kernel/`

#### [MODIFY] [KernelUIModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelUIModule.ts)

Add `showOverlay` action handler:
1. Validate `ui:overlay` capability (`requireCapability(pluginId, 'ui:overlay')`)
2. Check that this plugin has no existing open overlay (else throw `OVERLAY_ALREADY_OPEN`)
3. Assign `overlayId = uuid()`
4. Call `this.overlayHost.showWebviewOverlay({ overlayId, pluginId, ...opts })`
5. **Model A**: Store a pending `{ resolve, reject }` in a map keyed by `overlayId`. Return the Promise.
6. **Model B** (`mode: 'handle'`): Return `{ overlayId }` immediately. Incoming events are forwarded to the plugin channel via `kernel:ui:overlay:event { overlayId, event, data }`.

Add handlers for:
- `kernel:ui:overlay:send` — forward `{ event, data }` to the renderer webview (plugin → overlay)
- `kernel:ui:overlay:close` — command renderer to unmount, resolve pending if Model A

#### [MODIFY] `src/main/kernel/ui/IOverlayHost.ts`

Extend with webview overlay contract:

```typescript
export interface WebviewOverlayRequest {
  overlayId: string
  pluginId: string
  panel: string
  context?: Record<string, unknown>
  width?: number
  height?: number
  title?: string
  mode: 'promise' | 'handle'
}

export interface IOverlayHost {
  // ... existing Tier 1 methods from Phase 11a ...
  showWebviewOverlay(req: WebviewOverlayRequest): void
  sendToOverlay(overlayId: string, event: string, data: unknown): void
  closeOverlay(overlayId: string): void
  // Called by IPC when overlay submits/emits/dismisses
  onOverlaySubmit(overlayId: string, data: unknown): void
  onOverlayEvent(overlayId: string, event: string, data: unknown): void
  onOverlayDismiss(overlayId: string): void
}
```

#### [MODIFY] `src/main/kernel/ui/OverlayHost.ts`

Implement new methods — delegate to `webContents.send(...)` for each.

---

### IPC Bridge

#### [MODIFY] `overlayIpc.ts` (or `contributionIpc.ts`)

Add IPC handlers for the reverse channel (renderer → main):

```typescript
// Overlay HTML called window.__smartchat.submit(data)
ipcMain.on('kernel:ui:overlay:submit',  (_, { overlayId, data }) => overlayHost.onOverlaySubmit(overlayId, data))

// Overlay HTML called window.__smartchat.emit(event, data)
ipcMain.on('kernel:ui:overlay:event',   (_, { overlayId, event, data }) => overlayHost.onOverlayEvent(overlayId, event, data))

// Overlay HTML called window.__smartchat.dismiss()
ipcMain.on('kernel:ui:overlay:dismiss', (_, { overlayId }) => overlayHost.onOverlayDismiss(overlayId))
```

---

### Preload Bridge — `src/preload/`

#### [MODIFY] `api.service.ts` and `IAPIService.ts`

Add:
```typescript
showWebviewOverlay(req: WebviewOverlayRequest): void       // main pushes to renderer
onOverlaySend(overlayId: string, event: string, data: unknown): void  // main → renderer → webview
closeOverlay(overlayId: string): void
onOverlayEvent(handler: (overlayId, event, data) => void): () => void  // renderer → main routing
```

---

### Renderer — `src/renderer/src/`

#### [NEW] `src/renderer/src/components/overlays/OverlayShell.tsx`

The host-rendered container for a plugin webview overlay. Responsibilities:
- Renders a modal backdrop + centered shell with optional `title` header (plugin name/icon + close button)
- Mounts `<webview>` with:
  - `src="plugin://[pluginId]/[panel]"`
  - `preload="[path/to/overlay-preload.js]"`
  - `partition="persist:plugin-[pluginId]"` (isolated session per plugin)
  - `nodeintegration={false}` / `sandbox` as appropriate
- On `dom-ready`:
  1. Reads all `--wa-*` custom properties from `:root` via `getComputedStyle(document.documentElement)`
  2. Sends `webview.send('smartchat:init', { tokens, context, overlayId })`
- Listens to `webview.addEventListener('ipc-message')`:
  - `smartchat:submit` → `window.api.overlaySubmit(overlayId, data)`
  - `smartchat:event`  → `window.api.overlayEvent(overlayId, event, data)`
  - `smartchat:dismiss` → `window.api.overlayDismiss(overlayId)`
- Handles incoming `overlay.send()` from plugin: listens to `window.api.onOverlaySend()` and re-sends into webview as `smartchat:receive { event, data }`
- Close button → `window.api.overlayDismiss(overlayId)`

#### [MODIFY] `src/renderer/src/components/overlays/ModalPortal.tsx` *(from Phase 11a)*

Extend to also handle `kernel:ui:overlay:show` push events. Maintains a separate `webviewOverlays` queue. Renders `<OverlayShell>` for each.

---

## Verification Plan

### Automated Tests

```bash
# KernelUIModule showOverlay action
npm run test:run -- src/main/tests/kernel/api-modules/KernelUIModule.test.ts

# Protocol handler registration
npm run test:run -- src/main/tests/kernel/protocol/pluginProtocol.test.ts

# Full regression
npm run test:run

npm run typecheck
npm run test:rebuild:electron
```

### Manual Verification

1. Write a test external `.scext` plugin with a `messageAction: "Translate"`. Handler calls `ctx.ui.showOverlay({ panel: 'overlays/translate.html', context: { text: messageText } })`. Verify:
   - Overlay appears over the chat
   - `text` is rendered correctly inside the overlay (from `smartchat:init` context)
   - `--wa-*` tokens applied — overlay matches app dark theme
   - Selecting a language and clicking "Translate" returns `{ language: 'fr' }` to the plugin handler
   - Plugin then acts on the result (e.g. sends a translated message)

2. Test Model B with a live-search overlay:
   - Overlay emits `query` events on keystroke
   - Plugin receives, queries, calls `overlay.send('results', [...])`
   - Overlay renders the results list
   - Picking a result calls `overlay.send` which resolves correctly

3. Verify `OVERLAY_ALREADY_OPEN` error: trigger a second overlay while first is still showing.

4. Verify webview is fully destroyed on close (no memory leak — check DevTools heap).

---

## Acceptance Criteria

- [ ] `plugin://` protocol resolves `.scext` extracted files correctly
- [ ] `overlay-preload.js` compiled and referenced in `<webview preload=...>`
- [ ] `window.__smartchat.submit/emit/dismiss` available in overlay HTML
- [ ] `smartchat:init` fires after `dom-ready` with both `tokens` and `context`
- [ ] `applyTokens()` in SDK correctly injects all `--wa-*` vars as `:root` CSS
- [ ] Model A: `showOverlay()` returns a Promise that resolves on `submit`, `null` on `dismiss`
- [ ] Model B: `showOverlay({ mode: 'handle' })` returns a `PluginOverlayHandle` with `on/send/close`
- [ ] `overlay.send()` reaches the webview as `smartchat:receive { event, data }`
- [ ] Only one overlay per plugin enforced (`OVERLAY_ALREADY_OPEN` error)
- [ ] Webview destroyed on close — no zombie webviews
- [ ] `OverlayShell` uses host design system for backdrop/header shell; plugin owns content area only
- [ ] Zero TypeScript errors (`npm run typecheck`)
- [ ] All existing tests pass
