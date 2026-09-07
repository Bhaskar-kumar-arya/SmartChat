import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { IOverlayHost, ModalRequest, WebviewOverlayOptions, WebviewOverlayRequest } from './IOverlayHost'
import { IPluginChannel } from '../channels/IPluginChannel'
import { KernelError } from '../api-modules/KernelErrors'

/**
 * Safety ceiling for a modal / handle-mode overlay that the renderer never
 * resolves or dismisses (window closed, webview crash, renderer bug). Without
 * it the pending entry leaks forever and — for overlays — permanently blocks
 * the plugin from opening another one. (S9-05)
 */
export const OVERLAY_PENDING_TIMEOUT_MS = 5 * 60_000

interface PendingModal {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

interface PendingOverlay {
  pluginId: string
  mode: 'promise' | 'handle'
  resolve?: (data: unknown) => void
  reject?: (err: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export class OverlayHost implements IOverlayHost {
  private pendingModals = new Map<string, PendingModal>()
  private pendingOverlays = new Map<string, PendingOverlay>()

  constructor(
    private readonly getMainWindow?: () => BrowserWindow | null,
    private readonly getPluginChannel?: (pluginId: string) => IPluginChannel | undefined
  ) {}

  private liveWindow(): BrowserWindow | null {
    const win = this.getMainWindow?.() ?? null
    if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())) {
      return win
    }
    return null
  }

  private armTimer(onFire: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(onFire, OVERLAY_PENDING_TIMEOUT_MS)
    if (typeof timer.unref === 'function') timer.unref()
    return timer
  }

  showModal(req: ModalRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const win = this.liveWindow()
      if (!win) {
        reject(new KernelError('WINDOW_UNAVAILABLE', 'Cannot show modal: main window is missing or destroyed'))
        return
      }
      const timer = this.armTimer(() => {
        if (this.pendingModals.delete(req.modalId)) {
          reject(new KernelError('MODAL_TIMEOUT', `Modal '${req.modalId}' was not resolved in time`))
        }
      })
      this.pendingModals.set(req.modalId, { resolve, reject, timer })
      win.webContents.send('kernel:ui:modal:show', req)
    })
  }

  resolveModal(modalId: string, data: unknown): void {
    const entry = this.pendingModals.get(modalId)
    if (entry) {
      this.pendingModals.delete(modalId)
      if (entry.timer) clearTimeout(entry.timer)
      entry.resolve(data)
    } else {
      console.warn('[OverlayHost] No pending promise found for modalId:', modalId)
    }
  }

  public isOverlayOwnedBy(overlayId: string, pluginId: string): boolean {
    return this.pendingOverlays.get(overlayId)?.pluginId === pluginId
  }

  public hasActiveOverlayForPlugin(pluginId: string): boolean {
    for (const entry of this.pendingOverlays.values()) {
      if (entry.pluginId === pluginId) {
        return true
      }
    }
    return false
  }

  async showOverlay(pluginId: string, opts: WebviewOverlayOptions): Promise<unknown> {
    if (this.hasActiveOverlayForPlugin(pluginId)) {
      throw new KernelError('OVERLAY_ALREADY_OPEN', `Plugin '${pluginId}' already has an active overlay open`)
    }

    if (!this.liveWindow()) {
      throw new KernelError('WINDOW_UNAVAILABLE', 'Cannot show overlay: main window is missing or destroyed')
    }

    const overlayId = randomUUID()
    const mode = opts.mode || 'promise'

    const req: WebviewOverlayRequest = {
      overlayId,
      pluginId,
      panel: opts.panel,
      context: opts.context,
      width: opts.width,
      height: opts.height,
      title: opts.title,
      mode
    }

    if (mode === 'handle') {
      const timer = this.armTimer(() => {
        // Evict the leaked entry so the plugin isn't permanently blocked from
        // opening another overlay. (S9-05)
        this.pendingOverlays.delete(overlayId)
      })
      this.pendingOverlays.set(overlayId, { pluginId, mode: 'handle', timer })
      this.sendOverlayShowToRenderer(req)
      return { overlayId }
    } else {
      return new Promise((resolve, reject) => {
        const timer = this.armTimer(() => {
          if (this.pendingOverlays.delete(overlayId)) {
            reject(new KernelError('OVERLAY_TIMEOUT', `Overlay '${overlayId}' was not dismissed in time`))
          }
        })
        this.pendingOverlays.set(overlayId, { pluginId, mode: 'promise', resolve, reject, timer })
        this.sendOverlayShowToRenderer(req)
      })
    }
  }

  private sendOverlayShowToRenderer(req: WebviewOverlayRequest): void {
    const win = this.liveWindow()
    if (win) {
      win.webContents.send('kernel:ui:overlay:show', req)
    } else {
      console.warn('[OverlayHost] Cannot send overlay request: main window is missing or destroyed')
    }
  }

  sendToOverlay(overlayId: string, event: string, data: unknown): void {
    const win = this.liveWindow()
    if (win) {
      win.webContents.send('kernel:ui:overlay:incoming', { overlayId, event, data })
    }
  }

  private evictOverlay(overlayId: string): PendingOverlay | undefined {
    const entry = this.pendingOverlays.get(overlayId)
    if (entry) {
      this.pendingOverlays.delete(overlayId)
      if (entry.timer) clearTimeout(entry.timer)
    }
    return entry
  }

  closeOverlay(overlayId: string): void {
    const win = this.liveWindow()
    if (win) {
      win.webContents.send('kernel:ui:overlay:close', { overlayId })
    }
    const entry = this.evictOverlay(overlayId)
    if (entry && entry.mode === 'promise') {
      entry.resolve?.(null)
    }
  }

  onOverlaySubmit(overlayId: string, data: unknown): void {
    const entry = this.evictOverlay(overlayId)
    if (entry) {
      if (entry.mode === 'promise') {
        entry.resolve?.(data)
      }
      this.closeOverlay(overlayId)
    }
  }

  onOverlayEvent(overlayId: string, event: string, data: unknown): void {
    const entry = this.pendingOverlays.get(overlayId)
    if (entry) {
      const channel = this.getPluginChannel?.(entry.pluginId)
      if (channel) {
        channel.sendToPlugin({
          id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          type: 'kernel:ui:overlay:event',
          payload: { overlayId, event, data }
        })
      }
    }
  }

  onOverlayDismiss(overlayId: string): void {
    const entry = this.evictOverlay(overlayId)
    if (entry) {
      if (entry.mode === 'promise') {
        entry.resolve?.(null)
      }
      this.closeOverlay(overlayId)
    }
  }

  /** Reject every outstanding modal/overlay promise on kernel teardown. (S9-05) */
  dispose(): void {
    for (const [, entry] of this.pendingModals) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(new KernelError('KERNEL_DISPOSED', 'Kernel is shutting down'))
    }
    this.pendingModals.clear()
    for (const [, entry] of this.pendingOverlays) {
      if (entry.timer) clearTimeout(entry.timer)
      if (entry.mode === 'promise') {
        entry.reject?.(new KernelError('KERNEL_DISPOSED', 'Kernel is shutting down'))
      }
    }
    this.pendingOverlays.clear()
  }
}
