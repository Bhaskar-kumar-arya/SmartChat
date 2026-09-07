import { ipcMain } from 'electron'
import { IPanelHost } from '../ui/IPanelHost'
import { IKernelAPIRouter } from '../IKernelAPIRouter'
import { IWAEventBus } from '../../services/whatsapp/IWAEventBus'
import { IPermissionStore } from '../permissions/IPermissionStore'
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

type BusArg = IWAEventBus | (() => IWAEventBus | null) | null | undefined

interface PanelSubscription {
  pluginId: string
  panelId: string
  eventName: string
  senderId: number | null
  handler: (payload: unknown) => void
  /** Detach `handler` from whichever bus it is currently attached to. */
  detach: () => void
  /** Re-point `handler` at a freshly created bus (reconnect). */
  rebind: (bus: IWAEventBus) => void
}

export interface PanelIpcRegistration {
  dispose: () => void
  /**
   * Call when a fresh WAEventBus becomes available (WhatsApp connect/reconnect).
   * `connect()` swaps in a brand-new bus instance on every reconnect, so every
   * live panel subscription must be re-attached to it or panel event delivery
   * silently dies after the first reconnect. (S9-01)
   */
  onBusConnected: (bus: IWAEventBus) => void
}

export function registerPanelIpcHandlers(
  panelHost: IPanelHost,
  router: IKernelAPIRouter,
  getBus?: BusArg,
  permissions?: IPermissionStore
): PanelIpcRegistration {
  const panelSubscriptions = new Map<string, PanelSubscription>()

  const resolveBus = (): IWAEventBus | null => {
    if (typeof getBus === 'function') return getBus()
    return getBus ?? null
  }

  const hasEventPermission = (pluginId: string, eventName: string): boolean => {
    // No permission store wired (tests/legacy) → don't gate.
    if (!permissions) return true
    return (
      permissions.hasCapability(pluginId, `events:${eventName}`) ||
      permissions.hasCapability(pluginId, 'events:*')
    )
  }

  const removeSubscription = (subKey: string): void => {
    const sub = panelSubscriptions.get(subKey)
    if (sub) {
      sub.detach()
      panelSubscriptions.delete(subKey)
    }
  }

  const removeSubscriptionsWhere = (pred: (sub: PanelSubscription) => boolean): void => {
    for (const [key, sub] of Array.from(panelSubscriptions.entries())) {
      if (pred(sub)) {
        sub.detach()
        panelSubscriptions.delete(key)
      }
    }
  }

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
    const sender = event.sender as unknown as {
      id?: number
      once?: (ev: string, cb: () => void) => void
    }
    const { panelId, eventName } = req || {}
    const pluginId = panelHost.getPluginId(panelId)
    if (!pluginId || !eventName) {
      return { ok: false, error: { code: 'PANEL_NOT_FOUND', message: `Panel '${panelId}' is not registered` } }
    }

    // Same permission gate the kernel events module applies (S9-02): a panel
    // must not be able to subscribe to WhatsApp bus events it never declared.
    if (!hasEventPermission(pluginId, eventName)) {
      return {
        ok: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: `Panel plugin '${pluginId}' lacks permission for event '${eventName}'`
        }
      }
    }

    const subKey = `${panelId}:${eventName}`
    removeSubscription(subKey)

    const handler = (payload: unknown) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('smartchat:event', { event: eventName, payload })
      }
    }

    let currentBus: IWAEventBus | null = null
    const attachTo = (bus: IWAEventBus | null) => {
      if (currentBus) currentBus.off(eventName as any, handler as any)
      currentBus = bus
      if (bus) bus.on(eventName as any, handler as any)
    }
    attachTo(resolveBus())

    const sub: PanelSubscription = {
      pluginId,
      panelId,
      eventName,
      senderId: typeof sender.id === 'number' ? sender.id : null,
      handler,
      detach: () => attachTo(null),
      rebind: (bus: IWAEventBus) => attachTo(bus)
    }
    panelSubscriptions.set(subKey, sub)

    // Clean up if the panel's webContents is torn down without a
    // kernel:panel:closed / unsubscribe message (navigation, crash). (S9-03)
    if (typeof sender.once === 'function' && sub.senderId != null) {
      const senderId = sub.senderId
      sender.once('destroyed', () => {
        removeSubscriptionsWhere((s) => s.senderId === senderId)
      })
    }

    return { ok: true }
  }

  const eventsUnsubscribeHandler = (
    _event: unknown,
    req: { panelId: string; eventName: string }
  ) => {
    const { panelId, eventName } = req || {}
    removeSubscription(`${panelId}:${eventName}`)
  }

  const panelClosedHandler = (_event: unknown, req: { panelId: string }) => {
    const { panelId } = req || {}
    if (!panelId) return
    removeSubscriptionsWhere((s) => s.panelId === panelId)
  }

  if (typeof ipcMain.handle === 'function') {
    ipcMain.handle('kernel:panel:api', panelApiHandler)
    ipcMain.handle('kernel:panel:events:subscribe', eventsSubscribeHandler)
  }
  if (typeof ipcMain.on === 'function') {
    ipcMain.on('kernel:panel:events:unsubscribe', eventsUnsubscribeHandler)
    ipcMain.on('kernel:panel:closed', panelClosedHandler)
  }

  return {
    onBusConnected: (bus: IWAEventBus) => {
      for (const sub of panelSubscriptions.values()) {
        sub.rebind(bus)
      }
    },
    dispose: () => {
      if (typeof ipcMain.removeHandler === 'function') {
        ipcMain.removeHandler('kernel:panel:api')
        ipcMain.removeHandler('kernel:panel:events:subscribe')
      }
      if (typeof ipcMain.removeListener === 'function') {
        ipcMain.removeListener('kernel:panel:events:unsubscribe', eventsUnsubscribeHandler as any)
        ipcMain.removeListener('kernel:panel:closed', panelClosedHandler as any)
      }
      for (const sub of panelSubscriptions.values()) {
        sub.detach()
      }
      panelSubscriptions.clear()
    }
  }
}
