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

const PLUGIN_ID = 'com.smartchat.voice-transcriber'

describe('Voice Transcriber Plugin - Overlay Integration', () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartchat-voice-transcriber-test-'))
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
      showOverlay: vi.fn().mockResolvedValue(undefined),
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
      sendMessage: vi.fn()
    }

    const mockMessageQueryService = {
      getChatMessages: vi.fn().mockResolvedValue([
        {
          id: 'msg-test-123',
          chatJid: '12345@s.whatsapp.net',
          messageType: 'audioMessage',
          content: JSON.stringify({ audioMessage: { localURI: 'nonexistent-audio-test-12345.ogg' } })
        }
      ]),
      getMessagesAroundId: vi.fn().mockResolvedValue([])
    }

    const mockMediaService = {
      downloadMedia: vi.fn().mockResolvedValue({ success: false })
    }

    const uiModule = new KernelUIModule(
      permissions,
      mockNotificationService as any,
      undefined,
      mockOverlayHost as any
    )
    const messagesModule = new KernelMessagesModule(
      permissions,
      mockMessageQueryService as any,
      mockMessageActionService as any,
      undefined,
      {} as any,
      () => tmpDir,
      mockMediaService as any,
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

  it('loads voice-transcriber-plugin and verifies transcribe action invokes showOverlay', async () => {
    const pluginFolder = path.join(__dirname, '../../../../../plugins/voice-transcriber-plugin')
    expect(fs.existsSync(pluginFolder)).toBe(true)

    // Install/load from directory source
    const manifestPath = path.join(pluginFolder, 'manifest.json')
    const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(rawManifest.id).toBe(PLUGIN_ID)
    expect(rawManifest.permissions).toContain('ui:overlay')
    expect(rawManifest.permissions).toContain('storage:read')
    expect(rawManifest.permissions).toContain('storage:write')
    expect(rawManifest.permissions).toContain('ui:panel')

    expect(rawManifest.contributions.sidebarPanels).toBeDefined()
    expect(rawManifest.contributions.sidebarPanels[0].panel).toBe('panels/transcriptions.html')

    // Verify overlay file exists
    const overlayHtml = path.join(pluginFolder, 'overlays/transcription.html')
    expect(fs.existsSync(overlayHtml)).toBe(true)
    const htmlContent = fs.readFileSync(overlayHtml, 'utf8')
    expect(htmlContent).toContain('Audio Transcription')
    expect(htmlContent).toContain('copyToClipboard')

    // Verify sidebar panel file exists
    const panelHtml = path.join(pluginFolder, 'panels/transcriptions.html')
    expect(fs.existsSync(panelHtml)).toBe(true)
    const panelContent = fs.readFileSync(panelHtml, 'utf8')
    expect(panelContent).toContain('Voice Transcriptions')
    expect(panelContent).toContain('loadHistory')

    // Verify overlay file contains progress box elements
    expect(htmlContent).toContain('progress-box')
    expect(htmlContent).toContain('spinner')
  })

  it('executes transcribe message action and verifies immediate showOverlay call with mode handle', async () => {
    mockOverlayHost.showOverlay = vi.fn().mockImplementation((...args) => {
      console.log('[Test Mock] showOverlay called with:', args)
      return Promise.resolve({ overlayId: 'ov-voice-123' })
    })

    const pluginFolder = path.join(__dirname, '../../../../../plugins/voice-transcriber-plugin')
    
    // Copy plugin files into tmpDir for loader
    const targetDir = path.join(tmpDir, PLUGIN_ID)
    fs.cpSync(pluginFolder, targetDir, { recursive: true })

    const manifestPath = path.join(pluginFolder, 'manifest.json')
    const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    permissions.registerPluginManifest(PLUGIN_ID, rawManifest.permissions)

    console.log('[Test] Loading plugin...')
    await host.load(PLUGIN_ID)
    console.log('[Test] Plugin loaded. List loaded:', host.listLoaded())

    const plugin = host.getPlugin(PLUGIN_ID)
    expect(plugin).toBeDefined()

    console.log('[Test] Sending transcribe action request...')
    plugin!.channel.sendToPlugin({
      id: 'exec-123',
      type: 'contribution:execute:message-action',
      payload: {
        id: 'transcribe',
        context: {
          messageId: 'msg-test-123',
          chatJid: '12345@s.whatsapp.net'
        }
      }
    })

    console.log('[Test] Waiting for showOverlay call...')
    for (let i = 0; i < 20; i++) {
      if (mockOverlayHost.showOverlay.mock.calls.length > 0) {
        console.log('[Test] showOverlay was called!')
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    expect(mockOverlayHost.showOverlay).toHaveBeenCalledWith(
      PLUGIN_ID,
      expect.objectContaining({
        panel: 'overlays/transcription.html',
        mode: 'handle',
        context: expect.objectContaining({
          status: 'loading'
        })
      })
    )
  })
})



