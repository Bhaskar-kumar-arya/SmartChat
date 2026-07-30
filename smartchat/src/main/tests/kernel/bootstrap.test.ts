import { describe, it, expect, beforeEach, vi } from 'vitest'
import { KernelBootstrapper } from '../../kernel/KernelBootstrapper'
import { ServiceContainer } from '../../ServiceContainer'

describe('KernelBootstrapper', () => {
  let mockServices: ServiceContainer

  beforeEach(() => {
    mockServices = {
      chatService: { getChatList: vi.fn(), getChatByJid: vi.fn(), markRead: vi.fn() },
      chatActionService: { pinChat: vi.fn(), archiveChat: vi.fn(), muteChat: vi.fn() },
      messageWriterService: {},
      messageQueryService: {},
      messageActionService: {},
      messageSenderService: {},
      contactService: { getContactByJid: vi.fn() },
      aiService: { chat: vi.fn() },
      toolRegistry: { executeTool: vi.fn() },
      notificationService: { notify: vi.fn() }
    } as unknown as ServiceContainer
  })

  it('boots kernel with built-in plugins loaded and contribution registry populated', async () => {
    const bootstrapper = new KernelBootstrapper({
      services: mockServices,
      getMainWindow: () => null,
      getBus: () => null,
      getSock: () => null,
      extensionsPath: '/tmp/fake-extensions-path-' + Date.now()
    })

    const result = await bootstrapper.boot()

    expect(result.host).toBeDefined()
    expect(result.registry).toBeDefined()
    expect(result.router).toBeDefined()

    const loadedPlugins = result.host.listLoaded()
    expect(loadedPlugins).toContain('com.smartchat.builtin.whatsapp-core')
    expect(loadedPlugins).toContain('com.smartchat.builtin.ai-assistant')
    expect(loadedPlugins).toContain('com.smartchat.builtin.notifications')


    const chatActions = result.registry.getAll('chat-action')
    expect(chatActions.length).toBeGreaterThan(0)
    expect(chatActions.some((a) => a.id === 'pin')).toBe(true)

    const aiTools = result.registry.getAll('ai-tool')
    expect(aiTools.length).toBeGreaterThan(0)

    const settingsPages = result.registry.getAll('settings-page')

    expect(settingsPages.some((p) => p.id === 'notifications')).toBe(true)

    await result.dispose()
  })

  it('accepts custom getUserDataPath option without throwing', async () => {
    const bootstrapper = new KernelBootstrapper({
      services: mockServices,
      getMainWindow: () => null,
      getBus: () => null,
      getSock: () => null,
      extensionsPath: '/tmp/fake-extensions-path-' + Date.now(),
      getUserDataPath: () => '/custom/user/data/path'
    })

    const result = await bootstrapper.boot()
    expect(result.host).toBeDefined()
    await result.dispose()
  })
})
