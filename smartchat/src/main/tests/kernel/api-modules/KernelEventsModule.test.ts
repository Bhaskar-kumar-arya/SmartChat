import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelEventsModule } from '../../../kernel/api-modules/KernelEventsModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'
import { IWAEventBus } from '../../../services/whatsapp/IWAEventBus'

describe('KernelEventsModule', () => {
  let mockPermissions: IPermissionStore
  let mockBus: IWAEventBus
  let module: KernelEventsModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn(),
      registerPluginManifest: vi.fn()
    }

    mockBus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn()
    }

    module = new KernelEventsModule(mockPermissions, mockBus)
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:events')
  })

  it('denies subscribe when plugin lacks event permission', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks permission for event 'message:incoming'",
      permission: 'events:message:incoming'
    })
  })

  it('allows subscribe when event permission is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = await module.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'events:message:incoming')
    expect(mockBus.on).toHaveBeenCalledWith('message:incoming', expect.any(Function))
    expect(result).toEqual({ success: true, event: 'message:incoming' })
  })

  it('allows unsubscribe', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    await module.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })
    const result = await module.handle('plugin-a', 'kernel:events:unsubscribe', { event: 'message:incoming' })

    expect(mockBus.off).toHaveBeenCalledWith('message:incoming', expect.any(Function))
    expect(result).toEqual({ success: true, event: 'message:incoming' })
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:events:unknown', {})
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:events:unknown' in module 'kernel:events'"
    })
  })

  it('forwards bus events to subscribing plugin channel', async () => {
    const mockChannel = {
      sendToPlugin: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      onPluginRequest: vi.fn(),
      destroy: vi.fn()
    }
    const getChannel = vi.fn().mockImplementation((pluginId: string) => {
      return pluginId === 'plugin-a' ? mockChannel : undefined
    })

    const eventsModule = new KernelEventsModule(mockPermissions, mockBus, getChannel)
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    let busHandler: ((data: any) => Promise<void>) | null = null
    vi.mocked(mockBus.on).mockImplementation((evt, fn) => {
      if (evt === 'message:incoming') {
        busHandler = fn as any
      }
      return mockBus
    })

    await eventsModule.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })
    expect(busHandler).not.toBeNull()

    const eventPayload = { id: 'msg-1', text: 'Hello World' }
    await busHandler!(eventPayload)

    expect(getChannel).toHaveBeenCalledWith('plugin-a')
    expect(mockChannel.sendToPlugin).toHaveBeenCalledWith({
      id: expect.stringMatching(/^evt:message:incoming:/),
      type: 'kernel:events:emit',
      payload: {
        event: 'message:incoming',
        payload: eventPayload
      }
    })
  })

  it('S3-01: re-attaches live subscriptions to a fresh bus on reconnect', async () => {
    const getChannel = vi.fn().mockReturnValue({
      sendToPlugin: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      onPluginRequest: vi.fn(),
      destroy: vi.fn()
    })
    const eventsModule = new KernelEventsModule(mockPermissions, mockBus, getChannel)
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    // Plugin subscribes while the initial bus is live (not queued as pending).
    await eventsModule.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })
    expect(mockBus.on).toHaveBeenCalledWith('message:incoming', expect.any(Function))

    // connect() tears down the old bus and swaps in a brand-new instance.
    const newBus: IWAEventBus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn()
    }
    eventsModule.onBusConnected(newBus)

    // The existing subscription must be re-registered on the new bus, otherwise
    // the plugin stops receiving WhatsApp events after the first reconnect.
    expect(newBus.on).toHaveBeenCalledWith('message:incoming', expect.any(Function))
  })

  it('S3-01: the new bus handler still forwards to the plugin channel after reconnect', async () => {
    const mockChannel = {
      sendToPlugin: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      onPluginRequest: vi.fn(),
      destroy: vi.fn()
    }
    const eventsModule = new KernelEventsModule(
      mockPermissions,
      mockBus,
      vi.fn().mockReturnValue(mockChannel)
    )
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    await eventsModule.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })

    let newHandler: ((data: any) => Promise<void>) | null = null
    const newBus: IWAEventBus = {
      on: vi.fn().mockImplementation((evt, fn) => {
        if (evt === 'message:incoming') newHandler = fn as any
        return newBus
      }),
      off: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn()
    }
    eventsModule.onBusConnected(newBus)
    expect(newHandler).not.toBeNull()

    await newHandler!({ id: 'm2' })
    expect(mockChannel.sendToPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'kernel:events:emit',
        payload: { event: 'message:incoming', payload: { id: 'm2' } }
      })
    )
  })

  it('sanitizes event payloads containing sock objects, functions, and bigints', async () => {
    const mockChannel = {
      sendToPlugin: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      onPluginRequest: vi.fn(),
      destroy: vi.fn()
    }
    const getChannel = vi.fn().mockReturnValue(mockChannel)
    const eventsModule = new KernelEventsModule(mockPermissions, mockBus, getChannel)
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    let busHandler: ((data: any) => Promise<void>) | null = null
    vi.mocked(mockBus.on).mockImplementation((evt, fn) => {
      if (evt === 'message:incoming') {
        busHandler = fn as any
      }
      return mockBus
    })

    await eventsModule.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })

    const rawPayload = {
      chatJid: '123@s.whatsapp.net',
      timestamp: BigInt(1753634000),
      sock: { worker: { _events: { newListener: () => {} } } },
      fnProp: () => {},
      processed: { id: 'msg-1', textContent: 'hello' }
    }

    await busHandler!(rawPayload)

    expect(mockChannel.sendToPlugin).toHaveBeenCalledWith({
      id: expect.stringMatching(/^evt:message:incoming:/),
      type: 'kernel:events:emit',
      payload: {
        event: 'message:incoming',
        payload: {
          chatJid: '123@s.whatsapp.net',
          timestamp: '1753634000',
          processed: { id: 'msg-1', textContent: 'hello' }
        }
      }
    })
  })
})
