import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { KernelBootstrapper } from '../../kernel/KernelBootstrapper'
import type { OverlayHost } from '../../kernel/ui/OverlayHost'
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

  describe('a plugin that fails to load (H-06)', () => {
    let extDir: string

    beforeEach(() => {
      extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h06-ext-'))
      // Valid manifests whose entry file does not exist, so loader.load() throws.
      for (const id of ['broken.one', 'broken.two']) {
        fs.mkdirSync(path.join(extDir, id))
        fs.writeFileSync(
          path.join(extDir, id, 'manifest.json'),
          JSON.stringify({
            id,
            name: id,
            version: '1.0.0',
            main: 'missing.js',
            apiVersion: '2',
            permissions: [],
            contributions: {}
          })
        )
      }
    })

    afterEach(() => {
      fs.rmSync(extDir, { recursive: true, force: true })
    })

    it('does not abort boot; other plugins load and the failed ones stay not-loaded', async () => {
      const bootstrapper = new KernelBootstrapper({
        services: mockServices,
        getMainWindow: () => null,
        getBus: () => null,
        getSock: () => null,
        extensionsPath: extDir
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await bootstrapper.boot()

      const loaded = result.host.listLoaded()
      expect(loaded).toContain('com.smartchat.builtin.whatsapp-core')
      expect(loaded).not.toContain('broken.one')
      expect(loaded).not.toContain('broken.two')
      // extension:list derives isLoaded from listInstalled() vs listLoaded()
      const installed = (await result.loader.listInstalled()).map((m) => m.id)
      expect(installed).toEqual(expect.arrayContaining(['broken.one', 'broken.two']))

      expect(result.host.getLoadError?.('broken.one')).toMatch(/./)

      await result.dispose()
    })

    it('B-KRN-16: uninstalling a plugin clears its stored data and permission grants', async () => {
      const storageRepo = { clear: vi.fn().mockResolvedValue(undefined) }
      const bootstrapper = new KernelBootstrapper({
        services: mockServices,
        getMainWindow: () => null,
        getBus: () => null,
        getSock: () => null,
        extensionsPath: extDir,
        storageRepo: storageRepo as never
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await bootstrapper.boot()
      await result.permissions.setCapability('broken.one', 'messages:read', false)

      await result.loader.uninstall('broken.one')

      expect(storageRepo.clear).toHaveBeenCalledWith('broken.one')
      expect(result.permissions.getPluginPermissions('broken.one').capabilities).toEqual({})
      await result.dispose()
    })
  })

  it.fails('unloading a plugin closes its overlays (F-KRN-3 / B-KRN-08)', async () => {
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    const bootstrapper = new KernelBootstrapper({
      services: mockServices,
      getMainWindow: () => win as never,
      getBus: () => null,
      getSock: () => null,
      extensionsPath: '/tmp/fake-extensions-path-' + Date.now()
    })
    const result = await bootstrapper.boot()
    const id = 'com.smartchat.builtin.notifications'
    const overlayHost = (result as unknown as { overlayHost: OverlayHost }).overlayHost
    await overlayHost.showOverlay(id, { panel: 'x.html', mode: 'handle' })

    await result.host.unload(id)

    expect(overlayHost.hasActiveOverlayForPlugin(id)).toBe(false)
    await result.dispose()
  })
})
