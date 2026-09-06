import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IWAEventBus, AsyncHandler } from '../../services/whatsapp/IWAEventBus'
import { WAEventMap } from '../../services/whatsapp/WAEventTypes'
import { IPluginChannel } from '../channels/IPluginChannel'
import { KernelPermissionError, KernelNotFoundError } from './KernelErrors'

export class KernelEventsModule extends BaseKernelModule {
  readonly namespace = 'kernel:events'
  private pluginSubscriptions = new Map<string, Map<string, AsyncHandler<any>>>()
  /** Subscriptions requested while the bus was null — replayed on the next onBusConnected() call */
  private pendingSubscriptions: Array<{ pluginId: string; event: keyof WAEventMap }> = []

  constructor(
    permissions: IPermissionStore,
    private readonly getBus: (() => IWAEventBus | null) | IWAEventBus | null = null,
    private readonly getChannel?: (pluginId: string) => IPluginChannel | undefined
  ) {
    super(permissions)
  }

  private resolveBus(): IWAEventBus | null {
    if (typeof this.getBus === 'function') return this.getBus()
    return this.getBus
  }

  /**
   * Called by the kernel when a new WAEventBus becomes available (WhatsApp connected).
   *
   * `connect()` calls `removeAllListeners()` on the old bus and swaps in a fresh
   * instance on *every* reconnect (settings toggle, re-login, cold start), so we
   * must re-attach every already-registered live subscription to the new bus —
   * not just the ones queued while no bus existed. Missing this silently kills
   * all plugin WhatsApp event delivery after the first reconnect. (S3-01)
   */
  public onBusConnected(bus: IWAEventBus): void {
    // Re-attach existing live subscriptions.
    for (const [pluginId, pluginMap] of this.pluginSubscriptions) {
      for (const event of pluginMap.keys()) {
        this.registerOnBus(bus, pluginId, event as keyof WAEventMap)
      }
    }
    // Drain subscriptions requested while the bus was null.
    for (const { pluginId, event } of this.pendingSubscriptions) {
      this.registerOnBus(bus, pluginId, event)
    }
    this.pendingSubscriptions = []
  }

  private registerOnBus(bus: IWAEventBus, pluginId: string, event: keyof WAEventMap): void {
    const handler: AsyncHandler<any> = async (_data: any) => {
      const channel = this.getChannel?.(pluginId)
      if (channel) {
        // Best-effort per-chat scope filter: if the payload names a single chat
        // and the plugin's events scope denies it, drop the event. Payloads with
        // no single resolvable chat jid (bulk contact/group updates, connection
        // state) are not filtered — `events:<event>` / `events:*` are
        // all-or-nothing for those. (S7-01)
        const chatJid = extractChatJid(_data)
        if (
          chatJid &&
          (!this.permissions.isResourceAllowed(pluginId, `events:${String(event)}`, chatJid) ||
            !this.permissions.isResourceAllowed(pluginId, 'events:*', chatJid))
        ) {
          return
        }
        const sanitizedData = sanitizeForPlugin(_data)
        channel.sendToPlugin({
          id: `evt:${String(event)}:${Date.now()}:${Math.random().toString(36).substring(2, 7)}`,
          type: 'kernel:events:emit',
          payload: {
            event: String(event),
            payload: sanitizedData
          }
        })
      }
    }

    if (!this.pluginSubscriptions.has(pluginId)) {
      this.pluginSubscriptions.set(pluginId, new Map())
    }
    const pluginMap = this.pluginSubscriptions.get(pluginId)!
    const existingHandler = pluginMap.get(String(event))
    if (existingHandler) {
      bus.off(event, existingHandler)
    }
    pluginMap.set(String(event), handler)
    bus.on(event, handler)
  }

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'subscribe': {
        const { event } = payload as { event: keyof WAEventMap }
        const perm = `events:${String(event)}`
        if (!this.permissions.hasCapability(pluginId, perm) && !this.permissions.hasCapability(pluginId, 'events:*')) {
          throw new KernelPermissionError(
            `Plugin '${pluginId}' lacks permission for event '${String(event)}'`,
            perm
          )
        }

        const bus = this.resolveBus()
        if (bus) {
          this.registerOnBus(bus, pluginId, event)
        } else {
          // Bus not yet available — queue for replay when WhatsApp connects
          this.pendingSubscriptions.push({ pluginId, event })
        }

        return { success: true, event: String(event) }
      }

      case 'unsubscribe': {
        const { event } = payload as { event: keyof WAEventMap }
        const bus = this.resolveBus()
        const pluginMap = this.pluginSubscriptions.get(pluginId)
        if (bus && pluginMap) {
          const handler = pluginMap.get(String(event))
          if (handler) {
            bus.off(event, handler)
            pluginMap.delete(String(event))
          }
        }
        return { success: true, event: String(event) }
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }
}

/** Extract a single owning chat jid from a WA event payload, if it has one. */
function extractChatJid(val: unknown): string | undefined {
  if (!val || typeof val !== 'object') return undefined
  const o = val as Record<string, any>
  const direct = o.chatJid ?? o.remoteJid ?? o.jid
  if (typeof direct === 'string' && direct.includes('@')) return direct
  const keyJid = o.key?.remoteJid
  if (typeof keyJid === 'string' && keyJid.includes('@')) return keyJid
  return undefined
}

function sanitizeForPlugin(val: unknown): unknown {
  if (val === null || val === undefined) return val
  const type = typeof val
  if (type === 'function' || type === 'symbol') {
    return undefined
  }
  if (type === 'bigint') {
    return (val as bigint).toString()
  }
  if (type === 'object') {
    if (Array.isArray(val)) {
      return val.map((item) => sanitizeForPlugin(item)).filter((v) => v !== undefined)
    }
    const clean: Record<string, unknown> = {}
    for (const key of Object.keys(val as object)) {
      if (key === 'sock') continue
      const cleanedVal = sanitizeForPlugin((val as Record<string, unknown>)[key])
      if (cleanedVal !== undefined) {
        clean[key] = cleanedVal
      }
    }
    return clean
  }
  return val
}
