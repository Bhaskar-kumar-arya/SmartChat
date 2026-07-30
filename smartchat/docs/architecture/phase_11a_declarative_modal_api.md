# Phase 11a — Declarative Modal API

## Goal

Implement `showForm`, `showConfirm`, and `showAlert` — the host-rendered, zero-webview-lag Tier 1 overlay calls. These cover ~90% of real plugin use cases (collecting user input before executing an action) and add no webview security surface. All rendering uses the existing React + `--wa-*` design system.

> [!IMPORTANT]
> Read `docs/architecture/microkernel.md` fully before starting — specifically §1.9, §6 (`IPluginUIAPI`), §11.1, and §11.2 (Tier 1 flow). This is the ground truth for all decisions.

---

## Proposed Changes

### SDK — `packages/sdk/`

#### [MODIFY] [context.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/context.ts)

Extend `IPluginUIAPI` with:
- `showForm<T>(schema: OverlayFormSchema): Promise<T | null>`
- `showConfirm(opts): Promise<boolean>`
- `showAlert(opts): Promise<void>`

Add new exported interfaces:
- `OverlayFormField`
- `OverlayFormSchema`

These are already fully specified in `microkernel.md §6`. Copy the type definitions verbatim.

#### [MODIFY] [channel.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/packages/sdk/src/channel.ts)

Inside `WorkerPluginRuntime`, extend the `ui` API builder to wire the three new methods:

```typescript
showForm:    (schema)  => this.request('kernel:ui:showForm', schema),
showConfirm: (opts)    => this.request('kernel:ui:showConfirm', opts),
showAlert:   (opts)    => this.request('kernel:ui:showAlert', opts),
```

These are simple `request()` calls — the kernel returns a Promise that resolves with the user's response.

---

### Kernel — `src/main/kernel/`

#### [MODIFY] [KernelUIModule.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/api-modules/KernelUIModule.ts)

Add three new action handlers under the `kernel:ui` namespace:

- **`showForm`**: Validates `ui:notification` capability. Assigns a `modalId` (UUID). Calls `this.overlayHost.showModal({ type: 'form', modalId, schema })`. Returns a Promise that is stored in a pending map keyed by `modalId`, resolved when the renderer sends back `kernel:ui:modal:resolve`.
- **`showConfirm`**: Same pattern, `type: 'confirm'`.
- **`showAlert`**: Same pattern, `type: 'alert'`. Always resolves with `undefined`.

Introduce `IOverlayHost` interface (see below) injected into the constructor — do not directly import `BrowserWindow`.

#### [NEW] `src/main/kernel/ui/IOverlayHost.ts`

```typescript
export interface ModalRequest {
  type: 'form' | 'confirm' | 'alert'
  modalId: string
  payload: unknown  // OverlayFormSchema | confirmOpts | alertOpts
}

export interface IOverlayHost {
  showModal(req: ModalRequest): void
  resolveModal(modalId: string, data: unknown): void  // called by IPC handler
}
```

This maintains DIP — `KernelUIModule` never imports from `electron` directly.

#### [NEW] `src/main/kernel/ui/OverlayHost.ts`

Concrete implementation. Holds reference to `BrowserWindow.webContents`. Implements `showModal` by doing `webContents.send('kernel:ui:modal:show', req)`. Implements `resolveModal` by looking up the pending map and calling `resolve(data)`.

#### [MODIFY] [KernelBootstrapper.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/kernel/KernelBootstrapper.ts)

Instantiate `OverlayHost` and inject into `KernelUIModule`. Wire the IPC handler `kernel:ui:modal:resolve` → `overlayHost.resolveModal(modalId, data)`.

---

### IPC Bridge — `src/main/kernel/ipc/`

#### [MODIFY] `contributionIpc.ts` or a new `overlayIpc.ts`

Add IPC handler:
```typescript
ipcMain.handle('kernel:ui:modal:resolve', (_, { modalId, data }) => {
  overlayHost.resolveModal(modalId, data)
})
```

---

### Preload — `src/preload/`

#### [MODIFY] `api.service.ts` and `IAPIService.ts`

Expose `onModalShow` (renderer receives push from main) and `resolveModal` (renderer sends answer back):

```typescript
onModalShow(handler: (req: ModalRequest) => void): () => void
resolveModal(modalId: string, data: unknown): void
```

---

### Renderer — `src/renderer/src/`

#### [NEW] `src/renderer/src/components/overlays/FormModal.tsx`

A React modal that:
- Receives `OverlayFormSchema` props
- Renders each field type: `text` → `<input>`, `textarea` → `<textarea>`, `select` → `<select>`, `radio` → radio group, `checkbox` → `<input type="checkbox">`
- Uses `--wa-*` CSS variables throughout (no hardcoded colors)
- Submit button → calls `window.api.resolveModal(modalId, formValues)`
- Cancel/dismiss → calls `window.api.resolveModal(modalId, null)`

#### [NEW] `src/renderer/src/components/overlays/ConfirmModal.tsx`

Simple modal with title, optional body, confirm/cancel buttons. Calls `resolveModal` with `true` or `false`.

#### [NEW] `src/renderer/src/components/overlays/AlertModal.tsx`

Informational modal with title, body, and a single dismiss button. Calls `resolveModal` with `undefined`.

#### [NEW] `src/renderer/src/components/overlays/ModalPortal.tsx`

A portal-rendered overlay manager. Listens to `window.api.onModalShow()`, maintains a queue of pending modals, renders the topmost one. Uses `ReactDOM.createPortal` into `document.body`.

#### [MODIFY] `src/renderer/src/App.tsx` (or root layout)

Mount `<ModalPortal />` at the root level so it renders above everything.

---

## Verification Plan

### Automated Tests

```bash
# Unit tests — KernelUIModule new actions
npm run test:run -- src/main/tests/kernel/api-modules/KernelUIModule.test.ts

# All tests regression
npm run test:run

# Typecheck
npm run typecheck

# Rebuild for Electron after tests
npm run test:rebuild:electron
```

### Manual Verification

1. Write a test built-in plugin that calls `ctx.ui.showConfirm({ title: 'Delete?', body: 'This is permanent.' })` from a `chatAction` handler. Verify the modal appears and the plugin receives `true`/`false`.
2. Write a test built-in plugin that calls `ctx.ui.showForm({ title: 'Translate', fields: [{ id: 'lang', type: 'select', label: 'Language', options: [...] }] })`. Verify the form renders with correct field types and returns filled values.
3. Verify modal uses `--wa-bg-secondary`, `--wa-primary`, `--wa-text-primary` — no color mismatch.
4. Verify dismissing (Escape key or clicking outside) resolves with `null` / `false`.

---

## Acceptance Criteria

- [ ] `IPluginUIAPI` in SDK `context.ts` includes `showForm`, `showConfirm`, `showAlert`
- [ ] `WorkerPluginRuntime` wires all three to `kernel:ui:*` requests
- [ ] `KernelUIModule` handles all three, uses `IOverlayHost` (no direct BrowserWindow import)
- [ ] Renderer `<ModalPortal>` mounts at root and renders correct modal component per type
- [ ] All `--wa-*` tokens used throughout modal components (zero hardcoded colors)
- [ ] `showForm` handles all 5 field types: `text`, `textarea`, `select`, `radio`, `checkbox`
- [ ] Submit resolves with form values; dismiss resolves with `null`
- [ ] `showConfirm` resolves `true` on confirm, `false` on cancel
- [ ] `showAlert` resolves `void` on dismiss
- [ ] Zero TypeScript errors (`npm run typecheck`)
- [ ] All existing tests pass
