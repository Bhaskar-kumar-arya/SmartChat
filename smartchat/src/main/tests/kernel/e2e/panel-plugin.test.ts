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
import { PanelHost } from '../../../kernel/ui/PanelHost'
import { registerPanelIpcHandlers } from '../../../kernel/ipc/panelIpc'
import { ipcMain } from 'electron'

vi.mock('electron', () => {
  const handlers = new Map<string, Function>()
  const listeners = new Map<string, Function>()

  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: Function) => {
        handlers.set(channel, fn)
      }),
      on: vi.fn((channel: string, fn: Function) => {
        listeners.set(channel, fn)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      }),
      removeListener: vi.fn((channel: string) => {
        listeners.delete(channel)
      }),
      _invokeHandle: (channel: string, event: unknown, opts: unknown) => {
        const fn = handlers.get(channel)
        if (fn) return fn(event, opts)
      },
      _emitOn: (channel: string, event: unknown, opts: unknown) => {
        const fn = listeners.get(channel)
        if (fn) return fn(event, opts)
      }
    }
  }
})


const PLUGIN_ID = 'com.smartchat.panel-test'
const PLUGIN_PERMISSIONS = ['ui:panel']

describe('Panel Plugin - End-to-End Integration Test', () => {
  let tmpDir: string
  let loader: PluginLoader
  let registry: PluginRegistry
  let router: KernelAPIRouter
  let contributionRegistry: ContributionRegistry
  let permissions: PermissionStore
  let panelHost: PanelHost

  let uiModule: KernelUIModule
  let mockWindow: { webContents: { send: ReturnType<typeof vi.fn> }; isDestroyed: () => boolean }
  let mockEventBus: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartchat-panel-plugin-test-'))
    const permissionsFile = path.join(tmpDir, 'permissions.json')
    fs.writeFileSync(permissionsFile, JSON.stringify({ plugins: {} }), 'utf8')

    loader = new PluginLoader(tmpDir)
    registry = new PluginRegistry()
    router = new KernelAPIRouter()
    contributionRegistry = new ContributionRegistry()
    permissions = new PermissionStore(permissionsFile)

    mockWindow = {
      webContents: { send: vi.fn() },
      isDestroyed: () => false
    }

    mockEventBus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn()
    }

    panelHost = new PanelHost(() => mockWindow as any)

    const mockNotificationService = {
      notify: vi.fn(),
      getPreferences: vi.fn(),
      getPreferencesSync: vi.fn(),
      setPreferences: vi.fn(),
      setActiveChat: vi.fn()
    }

    const mockOverlayHost = {
      showModal: vi.fn(),
      resolveModal: vi.fn(),
      showOverlay: vi.fn(),
      sendToOverlay: vi.fn(),
      closeOverlay: vi.fn()
    }

    uiModule = new KernelUIModule(
      permissions,
      mockNotificationService as any,
      () => mockWindow as any,
      mockOverlayHost as any,
      panelHost
    )

    router.registerModule(uiModule)
    new PluginHost(loader, registry, router, contributionRegistry)

    registerPanelIpcHandlers(panelHost, router, mockEventBus as any)
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('loads panel contributions and handles openPanel / closePanel IPC signals', async () => {
    const pluginDir = path.join(tmpDir, PLUGIN_ID)
    fs.mkdirSync(pluginDir, { recursive: true })

    const manifest = {
      apiVersion: '2',
      id: PLUGIN_ID,
      name: 'Panel Test Plugin',
      version: '1.0.0',
      description: 'E2E test plugin for panel UI',
      main: 'index.js',
      permissions: PLUGIN_PERMISSIONS,
      contributions: {
        'sidebar-panel': [
          {
            id: 'sidebar-1',
            title: 'My Custom Sidebar Panel',
            panel: 'panels/sidebar.html',
            icon: 'layout'
          }
        ],
        'settings-page': [
          {
            id: 'settings-1',
            title: 'My Custom Settings Page',
            panel: 'panels/settings.html',
            icon: 'settings'
          }
        ]
      }
    }

    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
    fs.writeFileSync(
      path.join(pluginDir, 'index.js'),
      `
        module.exports = {
          activate: function(ctx) {
            console.log('Panel test plugin activated');
          }
        };
      `,
      'utf8'
    )

    permissions.registerPluginManifest(PLUGIN_ID, PLUGIN_PERMISSIONS)

    const loaded = await loader.load(PLUGIN_ID)

    registry.register({ id: loaded.manifest.id, manifest: loaded.manifest, isBuiltin: false, channel: loaded.channel })






    // Register contributions in ContributionRegistry and PanelHost
    if (loaded.manifest.contributions) {
      for (const [slot, items] of Object.entries(loaded.manifest.contributions)) {
        if (Array.isArray(items)) {
          for (const item of items) {
            contributionRegistry.register(slot as any, {

              ...item,
              pluginId: loaded.manifest.id
            })
            if (slot === 'sidebar-panel' || slot === 'settings-page') {
              panelHost.registerPanel({
                pluginId: loaded.manifest.id,
                contributionId: item.id,
                panelPath: item.panel,
                type: slot === 'sidebar-panel' ? 'sidebar' : 'settings'
              })
            }
          }
        }
      }
    }

    // Verify registration in PanelHost
    const sidebarPanel = panelHost.findPanel(PLUGIN_ID, 'sidebar-1')
    expect(sidebarPanel).toBeDefined()
    expect(sidebarPanel?.contributionId).toEqual('sidebar-1')
    expect(sidebarPanel?.type).toEqual('sidebar')

    const settingsPanel = panelHost.findPanel(PLUGIN_ID, 'settings-1')
    expect(settingsPanel).toBeDefined()
    expect(settingsPanel?.contributionId).toEqual('settings-1')

    // Trigger openPanel via KernelUIModule (simulating ctx.ui.openPanel('sidebar-1'))
    const openRes = await uiModule.handle(PLUGIN_ID, 'kernel:ui:openPanel', { id: 'sidebar-1' })
    expect(openRes).toEqual({ success: true })

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('kernel:ui:panel:open', {
      contributionId: 'sidebar-1',
      pluginId: PLUGIN_ID,
      panelId: sidebarPanel!.panelId
    })

    // Trigger closePanel via KernelUIModule (simulating ctx.ui.closePanel('sidebar-1'))
    const closeRes = await uiModule.handle(PLUGIN_ID, 'kernel:ui:closePanel', { id: 'sidebar-1' })
    expect(closeRes).toEqual({ success: true })

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('kernel:ui:panel:close', {
      contributionId: 'sidebar-1',
      pluginId: PLUGIN_ID
    })

    // Test kernel:panel:api request via panelIpc
    const panelApiRes = await (ipcMain as unknown as { _invokeHandle: Function })._invokeHandle(
      'kernel:panel:api',
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      {
        panelId: sidebarPanel!.panelId,
        type: 'kernel:ui:openPanel',
        payload: { id: 'sidebar-1' }
      }
    )
    expect(panelApiRes.ok).toBe(true)
  })

  it('denies openPanel if plugin lacks ui:panel capability', async () => {
    permissions.registerPluginManifest(PLUGIN_ID, [])


    await expect(
      uiModule.handle(PLUGIN_ID, 'kernel:ui:openPanel', { id: 'sidebar-1' })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    })
  })
})
