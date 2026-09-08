import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IWAEventBus, AsyncHandler } from '../../services/whatsapp/IWAEventBus'
import { WAEventMap } from '../../services/whatsapp/WAEventTypes'
import { IPluginChannel } from '../channels/IPluginChannel'
import { KernelPermissionError, KernelNotFoundError } from './KernelErrors'

/**
 * Events that carry message/chat content for *many* chats in a single payload
 * (the jid lives under `messages[].key.remoteJid`, not at the top level). For a
 * chat-scoped subscription these must be filtered element-by-element or the
 * plugin receives the full cross-chat backlog. (S7-01)
 */
const MULTI_CHAT_ARRAY_EVENTS = new Set<string>(['messages:append'])

interface PluginSubscription {
  handler: AsyncHandler<any>
  /** The capability key the subscription was authorised under — scope is checked against this key only. (S7-02) */
  authKey: string
}

export class KernelEventsModule extends BaseKernelModule {
  readonly namespace = 'kernel:events'
  private pluginSubscriptions = new Map<string, Map<string, PluginSubscription>>()
  /** Subscriptions requested while the bus was null — replayed on the next onBusConnected() call */
  private pendingSubscriptions: Array<{ pluginId: string; event: keyof WAEventMap; authKey: string }> = []

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
      for (const [event, sub] of pluginMap) {
        this.registerOnBus(bus, pluginId, event as keyof WAEventMap, sub.authKey)
      }
    }
    // Drain subscriptions requested while the bus was null.
    for (const { pluginId, event, authKey } of this.pendingSubscriptions) {
      this.registerOnBus(bus, pluginId, event, authKey)
    }
    this.pendingSubscriptions = []
  }

  /**
   * Called by PluginHost when a plugin is unloaded/uninstalled: detach every
   * bus handler it registered and forget its subscriptions, otherwise the
   * orphaned handlers keep deep-cloning every WA event for the life of the bus
   * and accumulate across reloads. (S8-06)
   */
  public removePlugin(pluginId: string): void {
    const bus = this.resolveBus()
    const pluginMap = this.pluginSubscriptions.get(pluginId)
    if (pluginMap) {
      if (bus) {
        for (const [event, sub] of pluginMap) {
          bus.off(event as keyof WAEventMap, sub.handler)
        }
      }
      this.pluginSubscriptions.delete(pluginId)
    }
    this.pendingSubscriptions = this.pendingSubscriptions.filter((s) => s.pluginId !== pluginId)
  }

  private registerOnBus(bus: IWAEventBus, pluginId: string, event: keyof WAEventMap, authKey: string): void {
    const eventName = String(event)
    const handler: AsyncHandler<any> = async (_data: any) => {
      const channel = this.getChannel?.(pluginId)
      if (channel) {
        const allowed = (jid: string): boolean =>
          this.permissions.isResourceAllowed(pluginId, authKey, jid)

        let payload: any = _data

        if (MULTI_CHAT_ARRAY_EVENTS.has(eventName)) {
          // The payload carries content for many chats; scope it down to the
          // plugin's allow-list per array element. `isResourceAllowed` is
          // default-allow, so an unscoped plugin keeps the whole payload. (S7-01)
          const filtered = filterMultiChatArrayPayload(eventName, _data, allowed)
          if (!filtered) return
          payload = filtered
        } else {
          // Best-effort per-chat scope filter: if the payload names a single
          // chat and the plugin's events scope denies it, drop the event.
          // Checked against the capability key the subscription was authorised
          // under only — not an AND across both keys. (S7-01, S7-02)
          const chatJid = extractChatJid(_data)
          if (chatJid && !allowed(chatJid)) {
            return
          }
        }
        const sanitizedData = sanitizeForPlugin(payload)
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
    const existing = pluginMap.get(eventName)
    if (existing) {
      bus.off(event, existing.handler)
    }
    pluginMap.set(eventName, { handler, authKey })
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

        // Remember which capability key authorised this subscription so the
        // delivery-time scope filter checks that key only. (S7-02)
        const authKey = this.permissions.hasCapability(pluginId, perm) ? perm : 'events:*'

        const bus = this.resolveBus()
        if (bus) {
          this.registerOnBus(bus, pluginId, event, authKey)
        } else {
          // Bus not yet available — queue for replay when WhatsApp connects
          this.pendingSubscriptions.push({ pluginId, event, authKey })
        }

        return { success: true, event: String(event) }
      }

      case 'unsubscribe': {
        const { event } = payload as { event: keyof WAEventMap }
        const bus = this.resolveBus()
        // Also drop any not-yet-replayed pending entry, or a sub→unsub before
        // the bus connects still subscribes on connect. (S8-06)
        this.pendingSubscriptions = this.pendingSubscriptions.filter(
          (s) => !(s.pluginId === pluginId && s.event === event)
        )
        const pluginMap = this.pluginSubscriptions.get(pluginId)
        if (bus && pluginMap) {
          const sub = pluginMap.get(String(event))
          if (sub) {
            bus.off(event, sub.handler)
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

/**
 * Filter a multi-chat array event payload down to the array elements whose
 * owning chat the plugin is allowed to see. Returns the narrowed payload, or
 * `undefined` if nothing remains (the event should not be delivered). (S7-01)
 */
function filterMultiChatArrayPayload(
  eventName: string,
  data: unknown,
  allowed: (jid: string) => boolean
): unknown | undefined {
  if (!data || typeof data !== 'object') return data
  if (eventName === 'messages:append') {
    const o = data as { messages?: unknown[] }
    if (!Array.isArray(o.messages)) return data
    const kept = o.messages.filter((m) => {
      const jid = (m as { key?: { remoteJid?: unknown } })?.key?.remoteJid
      return typeof jid === 'string' ? allowed(jid) : true
    })
    if (kept.length === 0) return undefined
    return { ...o, messages: kept }
  }
  return data
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
