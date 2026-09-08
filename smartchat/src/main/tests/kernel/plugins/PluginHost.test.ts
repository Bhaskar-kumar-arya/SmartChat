import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginHost } from '../../../kernel/plugins/PluginHost'
import { IPluginRegistry } from '../../../kernel/plugins/IPluginRegistry'
import { IPluginLoader } from '../../../kernel/plugins/IPluginLoader'
import { IKernelAPIRouter } from '../../../kernel/IKernelAPIRouter'
import { IContributionRegistry } from '../../../kernel/contributions/IContributionRegistry'
import { IBuiltinPlugin } from '../../../kernel/plugins/IBuiltinPlugin'
import { IPluginChannel } from '../../../kernel/channels/IPluginChannel'
import { PluginMetadata } from '../../../kernel/plugins/IPluginHost'
import { PluginManifest } from '../../../kernel/plugins/PluginManifest'

describe('PluginHost (Decoupled Unit Tests)', () => {
  let registry: IPluginRegistry
  let loader: IPluginLoader
  let router: IKernelAPIRouter
  let contributionRegistry: IContributionRegistry
  let host: PluginHost
  let registeredPlugins: Map<string, PluginMetadata>

  beforeEach(() => {
    registeredPlugins = new Map()
    registry = {
      register: vi.fn((meta) => registeredPlugins.set(meta.id, meta)),
      unregister: vi.fn((id) => registeredPlugins.delete(id)),
      get: vi.fn((id) => registeredPlugins.get(id)),
      listLoaded: vi.fn(() => Array.from(registeredPlugins.keys()))
    }
    loader = {
      install: vi.fn(),
      uninstall: vi.fn(),
      load: vi.fn(),
      reload: vi.fn(),
      listInstalled: vi.fn().mockResolvedValue([])
    }
    router = {
      registerModule: vi.fn(),
      unregisterModule: vi.fn(),
      getModule: vi.fn(),
      attachChannel: vi.fn().mockReturnValue(() => {}),
      handleRequest: vi.fn(),
      handle: vi.fn()
    }

    contributionRegistry = {
      register: vi.fn(),
      unregisterAll: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      getAllSlots: vi.fn().mockReturnValue([]),
      onChange: vi.fn().mockReturnValue(() => {})
    }
    host = new PluginHost(loader, registry, router, contributionRegistry)
  })

  it('registerBuiltin() calls activate() with PluginContext and registers plugin metadata', async () => {
    const activateFn = vi.fn().mockResolvedValue(undefined)
    const builtin: IBuiltinPlugin = {
      id: 'com.builtin.test',
      manifest: {
        id: 'com.builtin.test',
        name: 'Builtin Test',
        version: '1.0.0',
        apiVersion: '2',
        main: 'index.ts',
        permissions: [],
        contributions: {}
      },
      activate: activateFn,
      deactivate: vi.fn().mockResolvedValue(undefined)
    }

    await host.registerBuiltin(builtin)

    expect(activateFn).toHaveBeenCalledTimes(1)
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.builtin.test', isBuiltin: true })
    )
    expect(router.attachChannel).toHaveBeenCalledWith('com.builtin.test', expect.anything())
    expect(host.listLoaded()).toContain('com.builtin.test')
  })

  it('unload() removes plugin, deactivates built-in, unregisters contributions, and destroys channel', async () => {
    const deactivateFn = vi.fn().mockResolvedValue(undefined)
    const builtin: IBuiltinPlugin = {
      id: 'com.builtin.test',
      manifest: {
        id: 'com.builtin.test',
        name: 'Builtin Test',
        version: '1.0.0',
        apiVersion: '2',
        main: 'index.ts',
        permissions: [],
        contributions: {}
      },
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: deactivateFn
    }

    await host.registerBuiltin(builtin)
    expect(host.listLoaded()).toContain('com.builtin.test')

    await host.unload('com.builtin.test')

    expect(deactivateFn).toHaveBeenCalledTimes(1)
    expect(registry.unregister).toHaveBeenCalledWith('com.builtin.test')
    expect(contributionRegistry.unregisterAll).toHaveBeenCalledWith('com.builtin.test')
    expect(host.listLoaded()).not.toContain('com.builtin.test')
  })

  it('S8-07 / S7-04 / S8-06: unload() awaits worker deactivate ack and runs the kernel teardown hook', async () => {
    const onPluginUnload = vi.fn()
    const hookedHost = new PluginHost(loader, registry, router, contributionRegistry, onPluginUnload)

    const order: string[] = []
    const mockChannel = {
      sendToPlugin: vi.fn(),
      onPluginRequest: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      sendRequestToPlugin: vi.fn().mockImplementation(async (msg: any) => {
        if (msg.type === 'plugin:activate') {
          order.push('activate-ack')
          return { id: msg.id, ok: true }
        }
        expect(msg.type).toBe('plugin:deactivate')
        order.push('deactivate-ack')
        return { id: msg.id, ok: true }
      }),
      destroy: vi.fn().mockImplementation(() => order.push('destroy'))
    }
    const mockManifest: PluginManifest = {
      id: 'com.external.worker', name: 'W', version: '1.0.0', apiVersion: '2',
      main: 'dist/index.js', permissions: [], contributions: {}
    }
    vi.mocked(loader.load).mockResolvedValue({ manifest: mockManifest, channel: mockChannel as any })

    await hookedHost.load('com.external.worker')
    await hookedHost.unload('com.external.worker')

    expect(mockChannel.sendRequestToPlugin).toHaveBeenCalled()
    expect(onPluginUnload).toHaveBeenCalledWith('com.external.worker')
    // activate ack awaited on load; deactivate ack awaited before destroy
    expect(order).toEqual(['activate-ack', 'deactivate-ack', 'destroy'])
  })

  it('load() uses IPluginLoader mock without touching filesystem or worker threads', async () => {
    const mockChannel: IPluginChannel = {
      sendToPlugin: vi.fn(),
      onPluginRequest: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      destroy: vi.fn()
    }
    const mockManifest: PluginManifest = {
      id: 'com.external.mock',
      name: 'Mock External Plugin',
      version: '1.0.0',
      apiVersion: '2',
      main: 'dist/index.js',
      permissions: [],
      contributions: {
        chatActions: [{ id: 'action-1', label: 'Action 1' }],
        slashCommands: [{ name: 'cmd-1', description: 'Command 1' }]
      }
    }

    vi.mocked(loader.load).mockResolvedValue({ manifest: mockManifest, channel: mockChannel })

    await host.load('com.external.mock')

    expect(loader.load).toHaveBeenCalledWith('com.external.mock')
    expect(router.attachChannel).toHaveBeenCalledWith('com.external.mock', mockChannel)
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.external.mock', isBuiltin: false, manifest: mockManifest })
    )
    expect(contributionRegistry.register).toHaveBeenCalledWith('chat-action', expect.objectContaining({ id: 'action-1' }))
    expect(contributionRegistry.register).toHaveBeenCalledWith('slash-command', expect.objectContaining({ name: 'cmd-1' }))
    expect(mockChannel.sendToPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'plugin:activate' })
    )
  })

  it('loadAll() lists installed plugins via IPluginLoader and loads each', async () => {
    const mockChannel1: IPluginChannel = { sendToPlugin: vi.fn(), onPluginRequest: vi.fn(), sendResponseToPlugin: vi.fn(), destroy: vi.fn() }
    const mockChannel2: IPluginChannel = { sendToPlugin: vi.fn(), onPluginRequest: vi.fn(), sendResponseToPlugin: vi.fn(), destroy: vi.fn() }

    const manifest1: PluginManifest = { id: 'ext.p1', name: 'P1', version: '1.0.0', apiVersion: '2', main: 'main.js', permissions: [], contributions: {} }
    const manifest2: PluginManifest = { id: 'ext.p2', name: 'P2', version: '1.0.0', apiVersion: '2', main: 'main.js', permissions: [], contributions: {} }

    vi.mocked(loader.listInstalled).mockResolvedValue([manifest1, manifest2])
    vi.mocked(loader.load).mockImplementation(async (id) => {
      if (id === 'ext.p1') return { manifest: manifest1, channel: mockChannel1 }
      return { manifest: manifest2, channel: mockChannel2 }
    })

    await host.loadAll()

    expect(loader.listInstalled).toHaveBeenCalledTimes(1)
    expect(loader.load).toHaveBeenCalledWith('ext.p1')
    expect(loader.load).toHaveBeenCalledWith('ext.p2')
    expect(host.listLoaded()).toEqual(['ext.p1', 'ext.p2'])
  })

  it('dispatches kernel requests to registered built-in handlers via DirectPluginChannel', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    const builtin: IBuiltinPlugin = {
      id: 'com.builtin.action-test',
      manifest: {
        id: 'com.builtin.action-test',
        name: 'Builtin Action Test',
        version: '1.0.0',
        apiVersion: '2',
        main: 'index.ts',
        permissions: [],
        contributions: {
          chatActions: [{ id: 'test-action', label: 'Test Action' }]
        }
      },
      activate: async (ctx) => {
        ctx.contributions?.registerChatAction?.('test-action', handler)
      },
      deactivate: vi.fn().mockResolvedValue(undefined)
    }

    await host.registerBuiltin(builtin)
    const pluginMeta = host.getPlugin('com.builtin.action-test')
    expect(pluginMeta).toBeDefined()

    pluginMeta!.channel.sendToPlugin({
      id: 'req-1',
      type: 'contribution:execute:chat-action',
      payload: { id: 'test-action', context: { jid: '123@s.whatsapp.net' } }
    })

    expect(handler).toHaveBeenCalledWith({
      id: 'test-action',
      context: { jid: '123@s.whatsapp.net' }
    })
  })

  it('wires events and scheduler into PluginContext for built-in plugins', async () => {
    const eventHandler = vi.fn()
    let capturedCtx: any
    const builtin: IBuiltinPlugin = {
      id: 'com.builtin.event-test',
      manifest: {
        id: 'com.builtin.event-test',
        name: 'Event Test',
        version: '1.0.0',
        apiVersion: '2',
        main: 'index.ts',
        permissions: ['events:messages:upsert'],
        contributions: {}
      },
      activate: async (ctx) => {
        capturedCtx = ctx
        ctx.events?.on('messages:upsert' as any, eventHandler)
      },
      deactivate: vi.fn().mockResolvedValue(undefined)
    }

    await host.registerBuiltin(builtin)
    expect(capturedCtx.events).toBeDefined()
    expect(capturedCtx.scheduler).toBeDefined()

    const pluginMeta = host.getPlugin('com.builtin.event-test')
    expect(pluginMeta).toBeDefined()

    pluginMeta!.channel.sendToPlugin({
      id: 'evt-1',
      type: 'kernel:events:emit',
      payload: { event: 'messages:upsert', payload: { id: 'msg-123', text: 'Hello' } }
    })

    expect(eventHandler).toHaveBeenCalledWith({ id: 'msg-123', text: 'Hello' })
  })

  it('S8-02: load() rejects and rolls back when the worker fails to activate', async () => {
    const mockChannel = {
      sendToPlugin: vi.fn(),
      onPluginRequest: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      sendRequestToPlugin: vi.fn().mockResolvedValue({
        id: 'x',
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'activate blew up' }
      }),
      destroy: vi.fn()
    }
    const manifest: PluginManifest = {
      id: 'com.external.broken', name: 'B', version: '1.0.0', apiVersion: '2',
      main: 'dist/index.js', permissions: [],
      contributions: { chatActions: [{ id: 'a1', label: 'A1' }] }
    }
    vi.mocked(loader.load).mockResolvedValue({ manifest, channel: mockChannel as any })

    await expect(host.load('com.external.broken')).rejects.toThrow(/activate blew up/)
    expect(contributionRegistry.unregisterAll).toHaveBeenCalledWith('com.external.broken')
    expect(registry.unregister).toHaveBeenCalledWith('com.external.broken')
    expect(mockChannel.destroy).toHaveBeenCalled()
    expect(host.listLoaded()).not.toContain('com.external.broken')
  })

  it('S8-03: unload() still tears down when a built-in deactivate() throws', async () => {
    const onPluginUnload = vi.fn()
    const hookedHost = new PluginHost(loader, registry, router, contributionRegistry, onPluginUnload)
    const builtin: IBuiltinPlugin = {
      id: 'com.builtin.throwing',
      manifest: {
        id: 'com.builtin.throwing', name: 'T', version: '1.0.0', apiVersion: '2',
        main: 'index.ts', permissions: [], contributions: {}
      },
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockRejectedValue(new Error('boom'))
    }
    await hookedHost.registerBuiltin(builtin)
    await hookedHost.unload('com.builtin.throwing')

    expect(onPluginUnload).toHaveBeenCalledWith('com.builtin.throwing')
    expect(contributionRegistry.unregisterAll).toHaveBeenCalledWith('com.builtin.throwing')
    expect(registry.unregister).toHaveBeenCalledWith('com.builtin.throwing')
    expect(hookedHost.listLoaded()).not.toContain('com.builtin.throwing')
  })

  it('S8-04: reload() refuses a built-in plugin id', async () => {
    const builtin: IBuiltinPlugin = {
      id: 'com.builtin.reload-guard',
      manifest: {
        id: 'com.builtin.reload-guard', name: 'R', version: '1.0.0', apiVersion: '2',
        main: 'index.ts', permissions: [], contributions: {}
      },
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined)
    }
    await host.registerBuiltin(builtin)
    await expect(host.reload('com.builtin.reload-guard')).rejects.toThrow(/built-in/)
    expect(host.listLoaded()).toContain('com.builtin.reload-guard')
  })

  it('S8-05: one throwing event handler does not block siblings or the ack', async () => {
    const good = vi.fn()
    const builtin: IBuiltinPlugin = {
      id: 'com.builtin.evt-isolation',
      manifest: {
        id: 'com.builtin.evt-isolation', name: 'E', version: '1.0.0', apiVersion: '2',
        main: 'index.ts', permissions: ['events:messages:upsert'], contributions: {}
      },
      activate: async (ctx) => {
        ctx.events?.on('messages:upsert' as any, () => { throw new Error('handler boom') })
        ctx.events?.on('messages:upsert' as any, good)
      },
      deactivate: vi.fn().mockResolvedValue(undefined)
    }
    await host.registerBuiltin(builtin)
    const channel = host.getPlugin('com.builtin.evt-isolation')!.channel as any
    const ackSpy = vi.spyOn(channel, 'sendResponseToPlugin')

    channel.sendToPlugin({
      id: 'evt-1',
      type: 'kernel:events:emit',
      payload: { event: 'messages:upsert', payload: { id: 'm1' } }
    })
    await Promise.resolve()

    expect(good).toHaveBeenCalledWith({ id: 'm1' })
    expect(ackSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1', ok: true }))
  })

  it('S8-06: scheduler timers are cleared on unload', async () => {
    vi.useFakeTimers()
    try {
      const tick = vi.fn()
      const builtin: IBuiltinPlugin = {
        id: 'com.builtin.scheduler-leak',
        manifest: {
          id: 'com.builtin.scheduler-leak', name: 'S', version: '1.0.0', apiVersion: '2',
          main: 'index.ts', permissions: [], contributions: {}
        },
        activate: async (ctx) => { ctx.scheduler?.setInterval(1000, tick) },
        deactivate: vi.fn().mockResolvedValue(undefined)
      }
      await host.registerBuiltin(builtin)
      vi.advanceTimersByTime(2500)
      expect(tick).toHaveBeenCalledTimes(2)

      await host.unload('com.builtin.scheduler-leak')
      vi.advanceTimersByTime(5000)
      expect(tick).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
