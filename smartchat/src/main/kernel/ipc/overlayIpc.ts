import { ipcMain, IpcMainEvent } from 'electron'
import { IOverlayHost } from '../ui/IOverlayHost'

export function registerOverlayIpcHandlers(overlayHost: IOverlayHost): () => void {
  const resolveModalHandler = async (
    _event: unknown,
    opts: { modalId: string; data: unknown }
  ): Promise<void> => {
    overlayHost.resolveModal(opts.modalId, opts.data)
  }

  const overlaySubmitListener = (
    _event: IpcMainEvent,
    opts: { overlayId: string; data: unknown }
  ) => {
    overlayHost.onOverlaySubmit(opts.overlayId, opts.data)
  }

  const overlayEventListener = (
    _event: IpcMainEvent,
    opts: { overlayId: string; event: string; data: unknown }
  ) => {
    overlayHost.onOverlayEvent(opts.overlayId, opts.event, opts.data)
  }

  const overlayDismissListener = (
    _event: IpcMainEvent,
    opts: { overlayId: string }
  ) => {
    overlayHost.onOverlayDismiss(opts.overlayId)
  }

  if (typeof ipcMain.handle === 'function') {
    ipcMain.handle('kernel:ui:modal:resolve', resolveModalHandler)
  }
  if (typeof ipcMain.on === 'function') {
    ipcMain.on('kernel:ui:overlay:submit', overlaySubmitListener)
    ipcMain.on('kernel:ui:overlay:event', overlayEventListener)
    ipcMain.on('kernel:ui:overlay:dismiss', overlayDismissListener)
  }

  return () => {
    if (typeof ipcMain.removeHandler === 'function') {
      ipcMain.removeHandler('kernel:ui:modal:resolve')
    }
    if (typeof ipcMain.removeListener === 'function') {
      ipcMain.removeListener('kernel:ui:overlay:submit', overlaySubmitListener)
      ipcMain.removeListener('kernel:ui:overlay:event', overlayEventListener)
      ipcMain.removeListener('kernel:ui:overlay:dismiss', overlayDismissListener)
    }
  }
}
