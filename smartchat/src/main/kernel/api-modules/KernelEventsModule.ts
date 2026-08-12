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
   * Flushes all subscriptions that were queued while the bus was null.
   */
  public onBusConnected(bus: IWAEventBus): void {
    for (const { pluginId, event } of this.pendingSubscriptions) {
      this.registerOnBus(bus, pluginId, event)
    }
    this.pendingSubscriptions = []
  }

  private registerOnBus(bus: IWAEventBus, pluginId: string, event: keyof WAEventMap): void {
    const handler: AsyncHandler<any> = async (_data: any) => {
      const channel = this.getChannel?.(pluginId)
      if (channel) {
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
