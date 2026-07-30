import { ipcMain } from 'electron'
import { IPanelHost } from '../ui/IPanelHost'
import { IKernelAPIRouter } from '../IKernelAPIRouter'
import { IWAEventBus } from '../../services/whatsapp/IWAEventBus'
import { KernelError } from '../api-modules/KernelErrors'

function serializeError(err: unknown): { code: string; message: string } {
  if (err instanceof KernelError) {
    return { code: err.code, message: err.message }
  }
  if (err instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: err.message }
  }
  return { code: 'INTERNAL_ERROR', message: String(err) }
}

export function registerPanelIpcHandlers(
  panelHost: IPanelHost,
  router: IKernelAPIRouter,
  waEventBus?: IWAEventBus | null
): () => void {
  const panelSubscriptions = new Map<string, () => void>()

  const panelApiHandler = async (
    _event: unknown,
    req: { panelId: string; type: string; payload: unknown }
  ) => {
    const { panelId, type, payload } = req || {}
    const pluginId = panelHost.getPluginId(panelId)

    if (!pluginId) {
      return {
        ok: false,
        error: {
          code: 'PANEL_NOT_FOUND',
          message: `Panel '${panelId}' is not registered`
        }
      }
    }

    try {
      const result = await router.handle(pluginId, type, payload)
      return { ok: true, payload: result }
    } catch (err: unknown) {
      return { ok: false, error: serializeError(err) }
    }
  }

  const eventsSubscribeHandler = async (
    event: { sender: { isDestroyed: () => boolean; send: (channel: string, ...args: unknown[]) => void } },
    req: { panelId: string; eventName: string }
  ) => {
    const { panelId, eventName } = req || {}
    const pluginId = panelHost.getPluginId(panelId)
    if (!pluginId || !waEventBus) {
      return { ok: false }
    }

    const subKey = `${panelId}:${eventName}`
    const existing = panelSubscriptions.get(subKey)
    if (existing) {
      existing()
    }

    const handler = (payload: unknown) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('smartchat:event', { event: eventName, payload })
      }
    }

    waEventBus.on(eventName as any, handler as any)
    const cleanup = () => {
      waEventBus.off(eventName as any, handler as any)
    }

    panelSubscriptions.set(subKey, cleanup)
    return { ok: true }
  }

  const eventsUnsubscribeHandler = (
    _event: unknown,
    req: { panelId: string; eventName: string }
  ) => {
    const { panelId, eventName } = req || {}
    const subKey = `${panelId}:${eventName}`
    const unsub = panelSubscriptions.get(subKey)
    if (unsub) {
      unsub()
      panelSubscriptions.delete(subKey)
    }
  }


  const panelClosedHandler = (_event: unknown, req: { panelId: string }) => {
    const { panelId } = req || {}
    if (!panelId) return
    const prefix = `${panelId}:`
    for (const [key, unsub] of Array.from(panelSubscriptions.entries())) {
      if (key.startsWith(prefix)) {
        unsub()
        panelSubscriptions.delete(key)
      }
    }
  }

  if (typeof ipcMain.handle === 'function') {
    ipcMain.handle('kernel:panel:api', panelApiHandler)
    ipcMain.handle('kernel:panel:events:subscribe', eventsSubscribeHandler)
  }
  if (typeof ipcMain.on === 'function') {
    ipcMain.on('kernel:panel:events:unsubscribe', eventsUnsubscribeHandler)
    ipcMain.on('kernel:panel:closed', panelClosedHandler)
  }

  return () => {
    if (typeof ipcMain.removeHandler === 'function') {
      ipcMain.removeHandler('kernel:panel:api')
      ipcMain.removeHandler('kernel:panel:events:subscribe')
    }
    if (typeof ipcMain.removeListener === 'function') {
      ipcMain.removeListener('kernel:panel:events:unsubscribe', eventsUnsubscribeHandler as any)
      ipcMain.removeListener('kernel:panel:closed', panelClosedHandler as any)
    }
    for (const unsub of panelSubscriptions.values()) {
      unsub()
    }
    panelSubscriptions.clear()
  }
}


