import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { IOverlayHost, ModalRequest, WebviewOverlayOptions, WebviewOverlayRequest } from './IOverlayHost'
import { IPluginChannel } from '../channels/IPluginChannel'
import { KernelError } from '../api-modules/KernelErrors'

export class OverlayHost implements IOverlayHost {
  private pendingModals = new Map<string, (data: unknown) => void>()
  private pendingOverlays = new Map<
    string,
    {
      pluginId: string
      mode: 'promise' | 'handle'
      resolve?: (data: unknown) => void
      reject?: (err: Error) => void
    }
  >()

  constructor(
    private readonly getMainWindow?: () => BrowserWindow | null,
    private readonly getPluginChannel?: (pluginId: string) => IPluginChannel | undefined
  ) {}

  showModal(req: ModalRequest): Promise<unknown> {
    return new Promise((resolve) => {
      this.pendingModals.set(req.modalId, resolve)
      const win = this.getMainWindow?.()
      if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())) {
        win.webContents.send('kernel:ui:modal:show', req)
      } else {
        console.warn('[OverlayHost] Cannot send modal request: main window is missing or destroyed')
      }
    })
  }

  resolveModal(modalId: string, data: unknown): void {
    const resolve = this.pendingModals.get(modalId)
    if (resolve) {
      this.pendingModals.delete(modalId)
      resolve(data)
    } else {
      console.warn('[OverlayHost] No pending promise found for modalId:', modalId)
    }
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
      this.pendingOverlays.set(overlayId, { pluginId, mode: 'handle' })
      this.sendOverlayShowToRenderer(req)
      return { overlayId }
    } else {
      return new Promise((resolve, reject) => {
        this.pendingOverlays.set(overlayId, { pluginId, mode: 'promise', resolve, reject })
        this.sendOverlayShowToRenderer(req)
      })
    }
  }

  private sendOverlayShowToRenderer(req: WebviewOverlayRequest): void {
    const win = this.getMainWindow?.()
    if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())) {
      win.webContents.send('kernel:ui:overlay:show', req)
    } else {
      console.warn('[OverlayHost] Cannot send overlay request: main window is missing or destroyed')
    }
  }

  sendToOverlay(overlayId: string, event: string, data: unknown): void {
    const win = this.getMainWindow?.()
    if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())) {
      win.webContents.send('kernel:ui:overlay:incoming', { overlayId, event, data })
    }
  }

  closeOverlay(overlayId: string): void {
    const win = this.getMainWindow?.()
    if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())) {
      win.webContents.send('kernel:ui:overlay:close', { overlayId })
    }
    const entry = this.pendingOverlays.get(overlayId)
    if (entry) {
      this.pendingOverlays.delete(overlayId)
      if (entry.mode === 'promise') {
        entry.resolve?.(null)
      }
    }
  }

  onOverlaySubmit(overlayId: string, data: unknown): void {
    const entry = this.pendingOverlays.get(overlayId)
    if (entry) {
      this.pendingOverlays.delete(overlayId)
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
    const entry = this.pendingOverlays.get(overlayId)
    if (entry) {
      this.pendingOverlays.delete(overlayId)
      if (entry.mode === 'promise') {
        entry.resolve?.(null)
      }
      this.closeOverlay(overlayId)
    }
  }
}
