import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { PluginRegistry } from '../../../kernel/plugins/PluginRegistry'
import { PluginHost } from '../../../kernel/plugins/PluginHost'
import { KernelAPIRouter } from '../../../kernel/KernelAPIRouter'
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry'
import { PermissionStore } from '../../../kernel/permissions/PermissionStore'
import { KernelUIModule } from '../../../kernel/api-modules/KernelUIModule'
import { KernelMessagesModule } from '../../../kernel/api-modules/KernelMessagesModule'
import { KernelLogModule } from '../../../kernel/api-modules/KernelLogModule'
import { isBidirectionalPluginChannel } from '../../../kernel/channels/IPluginChannel'


const PLUGIN_ID = 'com.smartchat.declarative-modal-test'
const PLUGIN_PERMISSIONS = ['ui:notification', 'ui:modal', 'ui:toast', 'ui:overlay', 'chats:read', 'chats:write', 'messages:write']

describe('Declarative Modal Test Plugin - Webview Overlay Integration', () => {
  let tmpDir: string
  let loader: PluginLoader
  let registry: PluginRegistry
  let router: KernelAPIRouter
  let contributionRegistry: ContributionRegistry
  let permissions: PermissionStore
  let host: PluginHost
  let mockOverlayHost: {
    showModal: ReturnType<typeof vi.fn>
    resolveModal: ReturnType<typeof vi.fn>
    showOverlay: ReturnType<typeof vi.fn>
    sendToOverlay: ReturnType<typeof vi.fn>
    closeOverlay: ReturnType<typeof vi.fn>
  }
  let mockNotificationService: {
    notify: ReturnType<typeof vi.fn>
    getPreferences: ReturnType<typeof vi.fn>
    getPreferencesSync: ReturnType<typeof vi.fn>
    setPreferences: ReturnType<typeof vi.fn>
    setActiveChat: ReturnType<typeof vi.fn>
  }
  let mockMessageActionService: {
    sendMessage: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartchat-overlay-plugin-test-'))
    const permissionsFile = path.join(tmpDir, 'permissions.json')
    fs.writeFileSync(permissionsFile, JSON.stringify({ plugins: {} }), 'utf8')

    loader = new PluginLoader(tmpDir)
    registry = new PluginRegistry()
    router = new KernelAPIRouter()
    contributionRegistry = new ContributionRegistry()
    permissions = new PermissionStore(permissionsFile)

    mockOverlayHost = {
      showModal: vi.fn(),
      resolveModal: vi.fn(),
      showOverlay: vi.fn().mockResolvedValue({ text: 'Hello from Overlay E2E!' }),
      sendToOverlay: vi.fn(),
      closeOverlay: vi.fn()
    }

    mockNotificationService = {
      notify: vi.fn(),
      getPreferences: vi.fn(),
      getPreferencesSync: vi.fn(),
      setPreferences: vi.fn(),
      setActiveChat: vi.fn()
    }

    mockMessageActionService = {
      sendMessage: vi.fn().mockResolvedValue({
        id: 'msg-999',
        jid: '123456789@s.whatsapp.net',
        text: 'Hello from Overlay E2E!'
      })
    }

    const uiModule = new KernelUIModule(
      permissions,
      mockNotificationService as any,
      undefined,
      mockOverlayHost as any
    )
    const messagesModule = new KernelMessagesModule(
      permissions,
      {} as any,
      mockMessageActionService as any,
      undefined,
      {} as any,
      () => tmpDir,
      {} as any,
      {} as any
    )

    router.registerModule(uiModule)
    router.registerModule(messagesModule)
    router.registerModule(new KernelLogModule(permissions))

    host = new PluginHost(loader, registry, router, contributionRegistry)

  })

  afterEach(async () => {
    try {
      const loaded = host.listLoaded()
      for (const id of loaded) {
        await host.unload(id)
      }
    } catch {}
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('installs declarative modal test plugin, opens webview overlay for active chat', async () => {
    const scextPath = path.join(__dirname, '../../../../../plugins/declarative-modal-test.scext')
    const manifest = await loader.install(scextPath)
    expect(manifest.id).toBe(PLUGIN_ID)

    // Register manifest with its declared permissions
    permissions.registerPluginManifest(manifest.id, PLUGIN_PERMISSIONS)
    await permissions.setCapability(manifest.id, 'ui:overlay', true)

    await host.load(manifest.id)
    expect(registry.get(manifest.id)).toBeDefined()

    // Allow worker thread to run activation hooks and register contributions
    await new Promise((r) => setTimeout(r, 500))

    // Verify test-overlay-action chatAction is registered by PluginHost
    const chatActions = contributionRegistry.getAll('chat-action')
    const overlayAction = chatActions.find((a) => a.id === 'test-overlay-action')
    expect(overlayAction).toBeDefined()

    // Verify slash-command contribution is registered
    const slashCommands = contributionRegistry.getAll('slash-command')
    const overlayCmd = slashCommands.find((c) => c.name === 'overlay')
    expect(overlayCmd).toBeDefined()

    // Execute the /overlay slash-command on the plugin worker
    const metadata = registry.get(manifest.id)
    expect(metadata).toBeDefined()

    const { channel } = metadata!
    expect(isBidirectionalPluginChannel(channel)).toBe(true)

    if (isBidirectionalPluginChannel(channel)) {
      await channel.sendRequestToPlugin({
        id: 'req-exec-overlay',
        type: 'contribution:execute:slash-command',
        payload: { name: 'overlay', args: '', context: { chatJid: '123456789@s.whatsapp.net' } }
      })
    }

    // Allow async side effects (kernel:ui:showOverlay dispatch) to complete
    await new Promise((r) => setTimeout(r, 300))

    // Verify IOverlayHost.showOverlay was called with the correct panel and context
    expect(mockOverlayHost.showOverlay).toHaveBeenCalledWith(
      PLUGIN_ID,
      expect.objectContaining({
        panel: 'overlays/send_message.html',
        title: 'Compose & Send Message (Webview Overlay)',
        context: { chatJid: '123456789@s.whatsapp.net' }
      })
    )
  })
})
