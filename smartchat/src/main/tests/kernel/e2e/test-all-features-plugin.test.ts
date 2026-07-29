import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { PluginRegistry } from '../../../kernel/plugins/PluginRegistry'
import { PluginHost } from '../../../kernel/plugins/PluginHost'
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry'
import { KernelAPIRouter } from '../../../kernel/KernelAPIRouter'
import { PermissionStore } from '../../../kernel/permissions/PermissionStore'
import { KernelChatsModule } from '../../../kernel/api-modules/KernelChatsModule'
import { KernelMessagesModule } from '../../../kernel/api-modules/KernelMessagesModule'
import { KernelContactsModule } from '../../../kernel/api-modules/KernelContactsModule'
import { KernelAIModule } from '../../../kernel/api-modules/KernelAIModule'
import { KernelStorageModule, IKernelStorageRepository } from '../../../kernel/api-modules/KernelStorageModule'
import { KernelUIModule } from '../../../kernel/api-modules/KernelUIModule'
import { KernelEventsModule } from '../../../kernel/api-modules/KernelEventsModule'
import { WorkerPluginChannel } from '../../../kernel/channels/WorkerPluginChannel'

describe('External Plugin E2E Test (All Features)', () => {
  let tmpDir: string
  let scextPath: string
  let loader: PluginLoader
  let registry: PluginRegistry
  let contribRegistry: ContributionRegistry
  let router: KernelAPIRouter
  let permissions: PermissionStore
  let host: PluginHost
  let inMemoryStorage: Map<string, string>

  // Mock service instances
  let mockChatsService: any
  let mockMessagesQuery: any
  let mockMessagesAction: any
  let mockContactsService: any
  let mockAIService: any
  let mockToolRegistry: any
  let mockNotificationService: any
  let mockStorageRepo: IKernelStorageRepository

  const pluginId = 'com.smartchat.test-all-features'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartchat-all-features-e2e-'))
    const permFilePath = path.join(tmpDir, 'permissions.json')
    permissions = new PermissionStore(permFilePath)

    // Grant permissions for all capabilities to pluginId
    const capabilities = [
      'chats:read',
      'chats:write',
      'messages:read',
      'messages:send',
      'messages:delete',
      'contacts:read',
      'ai:chat',
      'ai:tools:call',
      'ai:tools:register',
      'storage:read',
      'storage:write',
      'ui:notification',
      'ui:toast',
      'events:*',
      'scheduler'
    ]

    for (const cap of capabilities) {
      await permissions.setCapability(pluginId, cap, true)
    }

    inMemoryStorage = new Map<string, string>()
    mockStorageRepo = {
      get: vi.fn(async (pId: string, key: string) => inMemoryStorage.get(`${pId}:${key}`)),
      set: vi.fn(async (pId: string, key: string, val: string) => {
        inMemoryStorage.set(`${pId}:${key}`, val)
      }),
      delete: vi.fn(async (pId: string, key: string) => {
        inMemoryStorage.delete(`${pId}:${key}`)
      }),
      clear: vi.fn(async (pId: string) => {
        for (const k of inMemoryStorage.keys()) {
          if (k.startsWith(`${pId}:`)) inMemoryStorage.delete(k)
        }
      }),
      keys: vi.fn(async (pId: string) => {
        const res: string[] = []
        for (const k of inMemoryStorage.keys()) {
          if (k.startsWith(`${pId}:`)) res.push(k.slice(pId.length + 1))
        }
        return res
      })
    }

    mockChatsService = {
      getChatList: vi.fn(async () => [{ jid: 'test@s.whatsapp.net', unreadCount: 0 }]),
      getChatByJid: vi.fn(async (jid: string) => ({ jid, unreadCount: 0 })),
      pinChat: vi.fn(async () => {}),
      unpinChat: vi.fn(async () => {}),
      archiveChat: vi.fn(async () => {}),
      unarchiveChat: vi.fn(async () => {}),
      muteChat: vi.fn(async () => {}),
      unmuteChat: vi.fn(async () => {}),
      markRead: vi.fn(async () => {})
    }

    mockMessagesQuery = {
      getChatMessages: vi.fn(async () => [{ id: 'msg123', body: 'hello' }])
    }
    mockMessagesAction = {
      deleteMessage: vi.fn(async () => {}),
      reactToMessage: vi.fn(async () => {}),
      sendMessageWorkflow: vi.fn(async (_sock: any, jid: string, text: string) => ({ id: 'sent123', jid, body: text }))
    }

    mockContactsService = {
      resolveName: vi.fn(async (_jid: string) => 'Alice')
    }

    mockAIService = {
      generateResponse: vi.fn(async (prompt: string) => `AI response to: ${prompt}`)
    }

    mockToolRegistry = {
      executeTool: vi.fn(async () => ({ text: 'tool result' })),
      registerTool: vi.fn()
    }

    mockNotificationService = {
      notify: vi.fn(async () => {}),
      toast: vi.fn()
    }

    const mockWin = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    }

    // Instantiate kernel API modules
    const chatsModule = new KernelChatsModule(permissions, mockChatsService)
    const messagesModule = new KernelMessagesModule(
      permissions,
      mockMessagesQuery,
      mockMessagesAction,
      () => ({} as any)
    )
    const contactsModule = new KernelContactsModule(permissions, mockContactsService)
    const aiModule = new KernelAIModule(permissions, mockAIService, mockToolRegistry)
    const storageModule = new KernelStorageModule(permissions, mockStorageRepo)
    const uiModule = new KernelUIModule(permissions, mockNotificationService, () => mockWin as any)
    const eventsModule = new KernelEventsModule(permissions, null)

    router = new KernelAPIRouter()
    router.registerModule(chatsModule)
    router.registerModule(messagesModule)
    router.registerModule(contactsModule)
    router.registerModule(aiModule)
    router.registerModule(storageModule)
    router.registerModule(uiModule)
    router.registerModule(eventsModule)

    loader = new PluginLoader(tmpDir)
    registry = new PluginRegistry()
    contribRegistry = new ContributionRegistry()
    host = new PluginHost(loader, registry, router, contribRegistry)

    scextPath = path.resolve(__dirname, '../../../../../plugins/test-all-features.scext')
  })

  afterEach(async () => {
    try {
      const loaded = host.listLoaded()
      for (const id of loaded) {
        await host.unload(id)
      }
    } catch {
      // ignore
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('installs, loads in worker thread, registers contributions across all 11 slots, handles requests, and unloads cleanly', async () => {
    // 1. Install packaged plugin into loader's base directory
    const manifest = await loader.install(scextPath)
    expect(manifest.id).toBe(pluginId)
    expect(manifest.apiVersion).toBe('2')

    // Register manifest capabilities in permission store
    permissions.registerPluginManifest(manifest.id, manifest.permissions)

    // Register declared contributions in registry (matching host registration protocol)
    const c = manifest.contributions
    if (c.chatActions) {
      for (const item of c.chatActions) {
        contribRegistry.register('chat-action', { pluginId, id: item.id, label: item.label, icon: item.icon })
      }
    }
    if (c.messageActions) {
      for (const item of c.messageActions) {
        contribRegistry.register('message-action', { pluginId, id: item.id, label: item.label, icon: item.icon })
      }
    }
    if (c.chatBadges) {
      for (const item of c.chatBadges) {
        contribRegistry.register('chat-badge', { pluginId, id: item.id, label: item.label })
      }
    }
    if (c.slashCommands) {
      for (const item of c.slashCommands) {
        contribRegistry.register('slash-command', { pluginId, name: item.name, description: item.description })
      }
    }
    if (c.sidebarPanels) {
      for (const item of c.sidebarPanels) {
        contribRegistry.register('sidebar-panel', { pluginId, id: item.id, title: item.title, icon: item.icon })
      }
    }
    if (c.settingsPages) {
      for (const item of c.settingsPages) {
        contribRegistry.register('settings-page', { pluginId, id: item.id, title: item.title })
      }
    }
    if (c.aiTools) {
      for (const item of c.aiTools) {
        contribRegistry.register('ai-tool', { pluginId, name: item.name, description: item.description, schema: item.schema })
      }
    }
    if (c.keyboardShortcuts) {
      for (const item of c.keyboardShortcuts) {
        contribRegistry.register('keyboard-shortcut', { pluginId, id: item.id, defaultBinding: item.defaultBinding, description: item.description })
      }
    }
    if (c.statusBarItems) {
      for (const item of c.statusBarItems) {
        contribRegistry.register('status-bar-item', { pluginId, id: item.id, alignment: item.alignment })
      }
    }
    if (c.chatFilters) {
      for (const item of c.chatFilters) {
        contribRegistry.register('chat-filter', { pluginId, id: item.id, label: item.label, icon: item.icon })
      }
    }
    if (c.chatSortStrategies) {
      for (const item of c.chatSortStrategies) {
        contribRegistry.register('chat-sort-strategy', { pluginId, id: item.id, label: item.label })
      }
    }

    // 2. Load external plugin (spins up worker thread)
    await host.load(pluginId)
    expect(host.listLoaded()).toContain(pluginId)

    // Give worker thread a moment to run activate hook and process messages
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // 3. Verify all 11 contribution slots are populated
    expect(contribRegistry.getAll('chat-action').some((x) => x.id === 'test-chat-action')).toBe(true)
    expect(contribRegistry.getAll('message-action').some((x) => x.id === 'test-message-action')).toBe(true)
    expect(contribRegistry.getAll('chat-badge').some((x) => x.id === 'test-badge')).toBe(true)
    expect(contribRegistry.getAll('slash-command').some((x) => x.name === 'test-cmd')).toBe(true)
    expect(contribRegistry.getAll('sidebar-panel').some((x) => x.id === 'test-sidebar')).toBe(true)
    expect(contribRegistry.getAll('settings-page').some((x) => x.id === 'test-settings')).toBe(true)
    expect(contribRegistry.getAll('ai-tool').some((x) => x.name === 'test_plugin_tool')).toBe(true)
    expect(contribRegistry.getAll('keyboard-shortcut').some((x) => x.id === 'test-shortcut')).toBe(true)
    expect(contribRegistry.getAll('status-bar-item').some((x) => x.id === 'test-status')).toBe(true)
    expect(contribRegistry.getAll('chat-filter').some((x) => x.id === 'test-filter')).toBe(true)
    expect(contribRegistry.getAll('chat-sort-strategy').some((x) => x.id === 'test-sort')).toBe(true)

    // 4. Verify activation hook updated storage
    const activeStatus = await mockStorageRepo.get(pluginId, 'status')
    expect(activeStatus).toBe('activated')

    // 5. Test chat-action execution on worker channel
    const metadata = registry.get(pluginId)
    expect(metadata).toBeDefined()
    const channel = metadata!.channel as WorkerPluginChannel

    const res1 = await channel.sendRequestToPlugin({
      id: 'req-chat-action-1',
      type: 'contribution:execute:chat-action',
      payload: { id: 'test-chat-action', context: { chatJid: 'test@s.whatsapp.net' } }
    })

    expect(res1.ok).toBe(true)
    expect(mockChatsService.getChatList).toHaveBeenCalled()
    expect(mockMessagesQuery.getChatMessages).toHaveBeenCalledWith('test@s.whatsapp.net', 1, 50)

    // 6. Test message-action execution
    const res2 = await channel.sendRequestToPlugin({
      id: 'req-msg-action-1',
      type: 'contribution:execute:message-action',
      payload: { id: 'test-message-action', context: { messageId: 'msg123' } }
    })

    expect(res2.ok).toBe(true)
    expect(mockMessagesAction.reactToMessage).toHaveBeenCalledWith(expect.anything(), 'msg123', '✨', 'test@s.whatsapp.net')

    // 7. Test slash-command execution
    const res3 = await channel.sendRequestToPlugin({
      id: 'req-slash-cmd-1',
      type: 'contribution:execute:slash-command',
      payload: { name: 'test-cmd', args: 'test args', context: { jid: 'test@s.whatsapp.net' } }
    })

    expect(res3.ok).toBe(true)
    expect(mockMessagesAction.sendMessageWorkflow).toHaveBeenCalledWith(expect.anything(), 'test@s.whatsapp.net', 'test working', undefined, undefined)

    // 8. Test ai-tool execution
    const res4 = await channel.sendRequestToPlugin({
      id: 'req-ai-tool-1',
      type: 'contribution:execute:ai-tool',
      payload: { name: 'test_plugin_tool', args: { query: 'test' } }
    })

    expect(res4.ok).toBe(true)
    expect(res4.payload).toEqual({ text: 'Tool test_plugin_tool executed successfully for "test"' })

    // 9. Test chat-badge computation
    const res5 = await channel.sendRequestToPlugin({
      id: 'req-chat-badge-1',
      type: 'contribution:compute:chat-badge',
      payload: { id: 'test-badge', chatJid: 'test@s.whatsapp.net' }
    })

    expect(res5.ok).toBe(true)
    expect(res5.payload).toEqual({ label: 'TEST', color: '#00FF00' })

    // 10. Unload plugin cleanly
    await host.unload(pluginId)

    expect(host.listLoaded()).not.toContain(pluginId)
    expect(contribRegistry.getAll('chat-action').some((x) => x.pluginId === pluginId)).toBe(false)
  }, 10000)
})
