import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerPanelIpcHandlers } from '../../../kernel/ipc/panelIpc'
import { createTestKernel, type TestKernel } from '../helpers/createTestKernel'
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
  let k: TestKernel

  beforeEach(() => {
    k = createTestKernel({ tmpPrefix: 'smartchat-panel-plugin-test-' })
    registerPanelIpcHandlers(k.panelHost, k.router, k.eventBus as any)
  })

  // Awaits worker exit BEFORE removing the temp dir (fixes the worker-start vs
  // rmSync race that surfaced as an unhandled "Cannot find module .../index.js").
  afterEach(async () => {
    await k.teardown()
  })

  it('loads panel contributions and handles openPanel / closePanel IPC signals', async () => {
    k.writePlugin({
      id: PLUGIN_ID,
      manifest: {
        name: 'Panel Test Plugin',
        description: 'E2E test plugin for panel UI',
        permissions: PLUGIN_PERMISSIONS,
        contributions: {
          sidebarPanels: [
            { id: 'sidebar-1', title: 'My Custom Sidebar Panel', panel: 'panels/sidebar.html', icon: 'layout' }
          ],
          settingsPages: [
            { id: 'settings-1', title: 'My Custom Settings Page', panel: 'panels/settings.html' }
          ]
        }
      }
    })

    k.permissions.registerPluginManifest(PLUGIN_ID, PLUGIN_PERMISSIONS)

    // loader.load() spawns a real worker that is NOT handed to the host; the
    // harness tracks it so teardown can await its exit.
    const loaded = await k.loader.load(PLUGIN_ID)
    expect(k.workers.spawned).toBe(1)

    k.registry.register({ id: loaded.manifest.id, manifest: loaded.manifest, isBuiltin: false, channel: loaded.channel })

    // Register contributions in ContributionRegistry and PanelHost
    if (loaded.manifest.contributions) {
      const SLOT_KIND: Record<string, string> = { sidebarPanels: 'sidebar-panel', settingsPages: 'settings-page' }
      for (const [key, items] of Object.entries(loaded.manifest.contributions)) {
        const slot = SLOT_KIND[key] ?? key
        if (Array.isArray(items)) {
          for (const item of items) {
            k.contributions.register(slot as any, {

              ...item,
              pluginId: loaded.manifest.id
            })
            if (slot === 'sidebar-panel' || slot === 'settings-page') {
              k.panelHost.registerPanel({
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
    const sidebarPanel = k.panelHost.findPanel(PLUGIN_ID, 'sidebar-1')
    expect(sidebarPanel).toBeDefined()
    expect(sidebarPanel?.contributionId).toEqual('sidebar-1')
    expect(sidebarPanel?.type).toEqual('sidebar')

    const settingsPanel = k.panelHost.findPanel(PLUGIN_ID, 'settings-1')
    expect(settingsPanel).toBeDefined()
    expect(settingsPanel?.contributionId).toEqual('settings-1')

    // Trigger openPanel via KernelUIModule (simulating ctx.ui.openPanel('sidebar-1'))
    const openRes = await k.uiModule.handle(PLUGIN_ID, 'kernel:ui:openPanel', { id: 'sidebar-1' })
    expect(openRes).toEqual({ success: true })

    expect(k.window.webContents.send).toHaveBeenCalledWith('kernel:ui:panel:open', {
      contributionId: 'sidebar-1',
      pluginId: PLUGIN_ID,
      panelId: sidebarPanel!.panelId
    })

    // Trigger closePanel via KernelUIModule (simulating ctx.ui.closePanel('sidebar-1'))
    const closeRes = await k.uiModule.handle(PLUGIN_ID, 'kernel:ui:closePanel', { id: 'sidebar-1' })
    expect(closeRes).toEqual({ success: true })

    expect(k.window.webContents.send).toHaveBeenCalledWith('kernel:ui:panel:close', {
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
    k.permissions.registerPluginManifest(PLUGIN_ID, [])


    await expect(
      k.uiModule.handle(PLUGIN_ID, 'kernel:ui:openPanel', { id: 'sidebar-1' })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    })
  })
})
