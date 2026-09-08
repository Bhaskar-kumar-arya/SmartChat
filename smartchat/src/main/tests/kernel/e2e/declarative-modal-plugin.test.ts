import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { PluginRegistry } from '../../../kernel/plugins/PluginRegistry'
import { PluginHost } from '../../../kernel/plugins/PluginHost'
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry'
import { KernelAPIRouter } from '../../../kernel/KernelAPIRouter'
import { PermissionStore } from '../../../kernel/permissions/PermissionStore'
import { KernelUIModule } from '../../../kernel/api-modules/KernelUIModule'
import { OverlayHost } from '../../../kernel/ui/OverlayHost'

describe('Declarative Modal Plugin E2E Test', () => {
  let tmpDir: string
  let loader: PluginLoader
  let pluginRegistry: PluginRegistry
  let contribRegistry: ContributionRegistry
  let router: KernelAPIRouter
  let permissions: PermissionStore
  let overlayHost: OverlayHost
  let mockMainWindow: any
  let mockNotificationService: any
  let host: PluginHost

  const pluginsDir = path.join(__dirname, '../../../../../plugins')
  const scextPath = path.join(pluginsDir, 'declarative-modal-test.scext')

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'declarative-modal-test-'))
    loader = new PluginLoader(tmpDir)
    pluginRegistry = new PluginRegistry()
    contribRegistry = new ContributionRegistry()
    router = new KernelAPIRouter()
    permissions = new PermissionStore()

    mockMainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn()
      }
    }

    mockNotificationService = {
      notify: vi.fn()
    }

    overlayHost = new OverlayHost(() => mockMainWindow)
    const uiModule = new KernelUIModule(permissions, mockNotificationService, () => mockMainWindow, overlayHost)
    router.registerModule(uiModule)

    host = new PluginHost(loader, pluginRegistry, router, contribRegistry)
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

  it('installs .scext plugin, auto-registers chatActions, and executes Tier 1 form, confirm, alert modal flows', async () => {
    // 1. Install .scext archive
    const manifest = await loader.install(scextPath)
    expect(manifest.id).toBe('com.smartchat.declarative-modal-test')

    permissions.registerPluginManifest(manifest.id, ['ui:notification', 'ui:modal', 'ui:toast'])
    await host.load(manifest.id)

    expect(host.listLoaded()).toContain(manifest.id)

    // 2. Check registered contributions
    const chatActions = contribRegistry.getAll('chat-action')
    expect(chatActions.length).toBeGreaterThanOrEqual(3)

    const formAction = chatActions.find((a) => a.id === 'test-form-action')
    const confirmAction = chatActions.find((a) => a.id === 'test-confirm-action')
    const alertAction = chatActions.find((a) => a.id === 'test-alert-action')

    expect(formAction).toBeDefined()
    expect(confirmAction).toBeDefined()
    expect(alertAction).toBeDefined()

    const uiModule = router.getModule('kernel:ui')!

    // 3. Test Form Modal Flow
    const showModalSpy = vi.spyOn(overlayHost, 'showModal')

    const formPromise = uiModule.handle(manifest.id, 'kernel:ui:showForm', {
      title: 'Configure Options',
      fields: [{ id: 'name', type: 'text', label: 'Name', defaultValue: 'John' }]
    })

    expect(showModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'form',
        payload: expect.objectContaining({ title: 'Configure Options' })
      })
    )

    const formReq = showModalSpy.mock.calls[0][0]
    overlayHost.resolveModal(formReq.modalId, { name: 'John' })

    const formResult = await formPromise
    expect(formResult).toEqual({ name: 'John' })

    // 4. Test Confirm Modal Flow
    const confirmPromise = uiModule.handle(manifest.id, 'kernel:ui:showConfirm', {
      title: 'Confirm Operation',
      body: 'Proceed?'
    })

    expect(showModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirm',
        payload: expect.objectContaining({ title: 'Confirm Operation' })
      })
    )

    const confirmReq = showModalSpy.mock.calls[1][0]
    overlayHost.resolveModal(confirmReq.modalId, true)

    const confirmResult = await confirmPromise
    expect(confirmResult).toBe(true)

    // 5. Test Alert Modal Flow
    const alertPromise = uiModule.handle(manifest.id, 'kernel:ui:showAlert', {
      title: 'System Alert',
      body: 'Important message'
    })

    expect(showModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'alert',
        payload: expect.objectContaining({ title: 'System Alert' })
      })
    )

    const alertReq = showModalSpy.mock.calls[2][0]
    overlayHost.resolveModal(alertReq.modalId, undefined)

    const alertResult = await alertPromise
    expect(alertResult).toBeUndefined()
  })
})
