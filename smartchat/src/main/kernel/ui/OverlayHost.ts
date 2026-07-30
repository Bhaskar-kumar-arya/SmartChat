import { BrowserWindow } from 'electron'
import { IOverlayHost, ModalRequest } from './IOverlayHost'

export class OverlayHost implements IOverlayHost {
  private pendingModals = new Map<string, (data: unknown) => void>()

  constructor(private readonly getMainWindow?: () => BrowserWindow | null) {}

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
}
