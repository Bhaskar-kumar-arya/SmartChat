import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry'
import { registerContributionIpcHandlers, getContributionSnapshot } from '../../../kernel/ipc/contributionIpc'
import { IPluginHost, PluginMetadata } from '../../../kernel/plugins/IPluginHost'
import { IPluginChannel } from '../../../kernel/channels/IPluginChannel'

describe('contributionIpc', () => {
  let registry: ContributionRegistry
  let mockHost: IPluginHost
  let handlers: Map<string, Function>

  beforeEach(() => {
    registry = new ContributionRegistry()
    handlers = new Map()

    vi.spyOn(ipcMain, 'handle').mockImplementation((channel: string, listener: any) => {
      handlers.set(channel, listener)
      return ipcMain
    })

    vi.spyOn(ipcMain, 'removeHandler').mockImplementation((channel: string) => {
      handlers.delete(channel)
      return ipcMain
    })

    mockHost = {
      load: vi.fn(),
      unload: vi.fn(),
      reload: vi.fn(),
      loadAll: vi.fn(),
      registerBuiltin: vi.fn(),
      getPlugin: vi.fn(),
      listLoaded: vi.fn()
    }
  })

  it('getContributionSnapshot returns snapshot of registered slots', () => {
    registry.register('chat-action', { pluginId: 'plugin-1', id: 'pin', label: 'Pin' })
    const snapshot = getContributionSnapshot(registry)

    expect(snapshot['chat-action']).toHaveLength(1)
    expect(snapshot['sidebar-panel']).toBeUndefined()
  })

  it('registers IPC handlers and returns snapshot on kernel:contributions:snapshot', async () => {
    registry.register('chat-action', { pluginId: 'p1', id: 'act1', label: 'Action 1' })
    const cleanup = registerContributionIpcHandlers(registry, mockHost)

    const snapshotHandler = handlers.get('kernel:contributions:snapshot')
    expect(snapshotHandler).toBeDefined()

    const snapshot = await snapshotHandler!()
    expect(snapshot['chat-action']).toHaveLength(1)

    cleanup()
    expect(handlers.get('kernel:contributions:snapshot')).toBeUndefined()
  })

  it('dispatches to plugin channel on kernel:contribution:execute', async () => {
    const mockChannel: IPluginChannel = {
      sendToPlugin: vi.fn(),
      sendResponseToPlugin: vi.fn(),
      onPluginRequest: vi.fn(),
      destroy: vi.fn()
    }

    const mockPlugin: PluginMetadata = {
      id: 'plugin-1',
      manifest: {
        id: 'plugin-1',
        name: 'Test Plugin',
        version: '1.0.0',
        apiVersion: '2',
        main: 'index.js',
        permissions: [],
        contributions: {}
      },
      channel: mockChannel,
      isBuiltin: false
    }

    vi.mocked(mockHost.getPlugin).mockReturnValue(mockPlugin)

    const cleanup = registerContributionIpcHandlers(registry, mockHost)
    const executeHandler = handlers.get('kernel:contribution:execute')

    await executeHandler!({}, { slot: 'chat-action', pluginId: 'plugin-1', id: 'action-1', context: { jid: '123@s.whatsapp.net' } })

    expect(mockChannel.sendToPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'contribution:execute:chat-action',
        payload: expect.objectContaining({
          id: 'action-1',
          context: { jid: '123@s.whatsapp.net' }
        })
      })
    )

    cleanup()
  })

  it('throws error on execute if plugin is not loaded', async () => {
    vi.mocked(mockHost.getPlugin).mockReturnValue(undefined)

    const cleanup = registerContributionIpcHandlers(registry, mockHost)
    const executeHandler = handlers.get('kernel:contribution:execute')

    await expect(
      executeHandler!({}, { slot: 'chat-action', pluginId: 'unknown-plugin', id: 'act' })
    ).rejects.toThrow('Plugin not loaded: unknown-plugin')

    cleanup()
  })

  it('notifies webContents when registry changes', () => {
    const mockSend = vi.fn()
    const getWebContents = () => ({ send: mockSend } as any)

    const cleanup = registerContributionIpcHandlers(registry, mockHost, getWebContents)

    registry.register('chat-action', { pluginId: 'p1', id: 'act1', label: 'Action 1' })

    expect(mockSend).toHaveBeenCalledWith(
      'kernel:contributions:updated',
      expect.objectContaining({
        'chat-action': expect.arrayContaining([expect.objectContaining({ id: 'act1' })])
      })
    )

    cleanup()
  })
})
