import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginHost } from '../../../kernel/plugins/PluginHost'
import { PluginRegistry } from '../../../kernel/plugins/PluginRegistry'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { KernelAPIRouter } from '../../../kernel/KernelAPIRouter'
import { IContributionRegistry } from '../../../kernel/contributions/IContributionRegistry'
import { IBuiltinPlugin } from '../../../kernel/plugins/IBuiltinPlugin'

describe('PluginHost', () => {
  let registry: PluginRegistry
  let loader: PluginLoader
  let router: KernelAPIRouter
  let contributionRegistry: IContributionRegistry
  let host: PluginHost

  beforeEach(() => {
    registry = new PluginRegistry()
    loader = new PluginLoader('/tmp/fake-plugins')
    router = new KernelAPIRouter()
    contributionRegistry = {
      register: vi.fn(),
      unregisterAll: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      onChange: vi.fn().mockReturnValue(() => {})
    }
    host = new PluginHost(loader, registry, router, contributionRegistry)
  })

  it('registerBuiltin() calls activate() with PluginContext and adds plugin to listLoaded()', async () => {
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
    const ctx = activateFn.mock.calls[0][0]
    expect(ctx.id).toBe('com.builtin.test')
    expect(host.listLoaded()).toContain('com.builtin.test')
  })

  it('unload() removes the plugin from listLoaded() and calls unregisterAll()', async () => {
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
    expect(host.listLoaded()).not.toContain('com.builtin.test')
    expect(contributionRegistry.unregisterAll).toHaveBeenCalledWith('com.builtin.test')
  })

  it('load() is idempotent (calling twice on loaded plugin does not load twice)', async () => {
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
      deactivate: vi.fn().mockResolvedValue(undefined)
    }

    await host.registerBuiltin(builtin)
    const initialLoadedCount = host.listLoaded().length

    // Calling load on an already loaded plugin should be idempotent
    await host.load('com.builtin.test')

    expect(host.listLoaded().length).toBe(initialLoadedCount)
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
})
