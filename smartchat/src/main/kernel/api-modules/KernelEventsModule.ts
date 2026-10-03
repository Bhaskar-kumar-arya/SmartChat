import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IWAEventBus, AsyncHandler } from '../../services/whatsapp/IWAEventBus'
import { WAEventMap } from '../../services/whatsapp/WAEventTypes'
import { IPluginChannel } from '../channels/IPluginChannel'
import { KernelPermissionError, KernelNotFoundError } from './KernelErrors'
import { EventDeliveryPolicy } from '../events/EventDeliveryPolicy'

interface PluginSubscription {
  handler: AsyncHandler<any>
  /** The bus this handler is attached to, so teardown works even when the bus getter now returns null. (F-KRN-3) */
  bus: IWAEventBus
  /** The capability key the subscription was authorised under — scope is checked against this key only. (S7-02) */
  authKey: string
}

export class KernelEventsModule extends BaseKernelModule {
  readonly namespace = 'kernel:events'
  private readonly policy: EventDeliveryPolicy
  private pluginSubscriptions = new Map<string, Map<string, PluginSubscription>>()
  /** Subscriptions requested while the bus was null — replayed on the next onBusConnected() call */
  private pendingSubscriptions: Array<{ pluginId: string; event: keyof WAEventMap; authKey: string }> = []

  constructor(
    permissions: IPermissionStore,
    private readonly getBus: (() => IWAEventBus | null) | IWAEventBus | null = null,
    private readonly getChannel?: (pluginId: string) => IPluginChannel | undefined
  ) {
    super(permissions)
    this.policy = new EventDeliveryPolicy(permissions)
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
    const pluginMap = this.pluginSubscriptions.get(pluginId)
    if (pluginMap) {
      for (const [event, sub] of pluginMap) {
        sub.bus.off(event as keyof WAEventMap, sub.handler)
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
        const decision = this.policy.decide(pluginId, eventName, authKey, _data)
        if (!decision.deliver) return
        const sanitizedData = decision.payload
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
      existing.bus.off(event, existing.handler)
    }
    pluginMap.set(eventName, { handler, authKey, bus })
    bus.on(event, handler)
  }

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'subscribe': {
        const { event } = payload as { event: keyof WAEventMap }
        // The capability key that authorised this subscription is remembered so
        // the delivery-time checks use that key only. (S7-02)
        const authKey = this.policy.resolveAuthKey(pluginId, String(event))
        if (!authKey) {
          throw new KernelPermissionError(
            `Plugin '${pluginId}' lacks permission for event '${String(event)}'`,
            `events:${String(event)}`
          )
        }

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
        // Also drop any not-yet-replayed pending entry, or a sub→unsub before
        // the bus connects still subscribes on connect. (S8-06)
        this.pendingSubscriptions = this.pendingSubscriptions.filter(
          (s) => !(s.pluginId === pluginId && s.event === event)
        )
        const pluginMap = this.pluginSubscriptions.get(pluginId)
        // Drop the live entry even when the bus is currently null, otherwise the
        // next onBusConnected() re-attaches a subscription the plugin cancelled.
        const sub = pluginMap?.get(String(event))
        if (sub) {
          sub.bus.off(event, sub.handler)
          pluginMap!.delete(String(event))
        }
        return { success: true, event: String(event) }
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }
}
