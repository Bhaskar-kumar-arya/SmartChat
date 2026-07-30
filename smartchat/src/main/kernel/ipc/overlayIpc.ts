import { ipcMain } from 'electron'
import { IOverlayHost } from '../ui/IOverlayHost'

export function registerOverlayIpcHandlers(overlayHost: IOverlayHost): () => void {
  const resolveHandler = async (
    _event: unknown,
    opts: { modalId: string; data: unknown }
  ): Promise<void> => {
    overlayHost.resolveModal(opts.modalId, opts.data)
  }

  ipcMain.handle('kernel:ui:modal:resolve', resolveHandler)

  return () => {
    ipcMain.removeHandler('kernel:ui:modal:resolve')
  }
}
