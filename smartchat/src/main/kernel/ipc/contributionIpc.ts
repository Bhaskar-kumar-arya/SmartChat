import { ipcMain, WebContents } from 'electron'
import { IContributionRegistry } from '../contributions/IContributionRegistry'
import { ContributionSlot } from '../contributions/ContributionPoints'
import { IPluginHost } from '../plugins/IPluginHost'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IPluginLoader } from '../plugins/IPluginLoader'
import { IToolRegistry } from '../../services/ai/IToolRegistry'
import { isBidirectionalPluginChannel } from '../channels/IPluginChannel'

import { IPanelHost } from '../ui/IPanelHost'

export function getContributionSnapshot(
  registry: IContributionRegistry,
  panelHost?: IPanelHost
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const slot of registry.getAllSlots()) {
    snapshot[slot] = registry.getAll(slot)
  }

  if (panelHost) {
    const panelIds: Record<string, string> = {}
    const sidebarPanels = registry.getAll('sidebar-panel')
    for (const p of sidebarPanels) {
      const found = panelHost.findPanel(p.pluginId, p.id)
      if (found) {
        panelIds[p.id] = found.panelId
      }
    }

    const settingsPages = registry.getAll('settings-page')
    for (const p of settingsPages) {
      const found = panelHost.findPanel(p.pluginId, p.id)
      if (found) {
        panelIds[p.id] = found.panelId
      }
    }

    snapshot.panelIds = panelIds
  }

  return snapshot
}

export function registerContributionIpcHandlers(
  registry: IContributionRegistry,
  host: IPluginHost,
  getWebContents?: () => WebContents | undefined,
  loader?: IPluginLoader,
  permissions?: IPermissionStore,
  toolRegistry?: IToolRegistry,
  panelHost?: IPanelHost
): () => void {

  // Tool names this handler has registered into the shared toolRegistry, keyed
  // to a signature of the contribution that produced them. Add-only sync left a
  // plugin's `ai-tool` entries live in the registry forever after it unloaded
  // (invoking them returned "Plugin <id> is not loaded"), and a reload with a
  // changed schema/description kept the stale definition. (P2-S9-01)
  const registeredAiTools = new Map<string, string>()

  const aiToolSignature = (contrib: {
    pluginId: string
    description: string
    schema?: unknown
  }): string => `${contrib.pluginId}::${contrib.description}::${JSON.stringify(contrib.schema ?? {})}`

  const syncAiTools = () => {
    if (!toolRegistry) return

    const aiTools = registry.getAll('ai-tool')
    const desired = new Map<string, { contrib: (typeof aiTools)[number]; sig: string }>()
    for (const contrib of aiTools) {
      // First declaration of a given name wins (matches previous behaviour).
      if (!desired.has(contrib.name)) {
        desired.set(contrib.name, { contrib, sig: aiToolSignature(contrib) })
      }
    }

    // Drop tools we own that the contribution registry no longer backs, or whose
    // defining contribution changed (schema/description/owner).
    for (const [name, sig] of Array.from(registeredAiTools.entries())) {
      const next = desired.get(name)
      if (!next || next.sig !== sig) {
        toolRegistry.unregisterTool(name)
        registeredAiTools.delete(name)
      }
    }

    for (const [name, { contrib, sig }] of desired) {
      if (registeredAiTools.has(name)) continue
      // A name already claimed by a builtin or another subsystem is not ours to
      // overwrite — leave it and let the conflict surface elsewhere.
      if (toolRegistry.getTool(name)) continue
      toolRegistry.registerTool({
        name: contrib.name,
        description: contrib.description,
        parametersSchema: contrib.schema || { type: 'object', properties: {} },
        requiresPermission: false,
        execute: async (args: Record<string, unknown>) => {
          const plugin = host.getPlugin(contrib.pluginId)
          if (!plugin) {
            return { text: `Plugin ${contrib.pluginId} is not loaded` }
          }
          if (!isBidirectionalPluginChannel(plugin.channel)) {
            return { text: `Plugin ${contrib.pluginId} channel does not support bidirectional requests` }
          }
          const reqId = `ai-tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          try {
            const res = await plugin.channel.sendRequestToPlugin({
              id: reqId,
              type: 'contribution:execute:ai-tool',
              payload: { name: contrib.name, args }
            })
            if (res.ok) {
              const out = typeof res.payload === 'string' ? res.payload : JSON.stringify(res.payload)
              return { text: out }
            }
            return { text: `Error: ${res.error?.message || 'Tool execution failed'}` }
          } catch (err) {
            // A worker-backed channel rejects (timeout / destroyed) rather than
            // resolving `ok:false`; don't let that throw out of the tool executor. (P2-S9-04)
            return { text: `Error: ${err instanceof Error ? err.message : 'Tool execution failed'}` }
          }
        }
      })
      registeredAiTools.set(name, sig)
    }
  }

  // Initial sync
  syncAiTools()
  const snapshotHandler = async () => {
    return getContributionSnapshot(registry, panelHost)
  }


  const executeHandler = async (
    _event: unknown,
    opts: { slot: ContributionSlot; pluginId: string; id: string; name?: string; args?: string; context?: Record<string, unknown> }
  ) => {
    console.log('[contributionIpc] executeHandler received request:', opts)
    const plugin = host.getPlugin(opts.pluginId)
    if (!plugin) {
      console.error(`[contributionIpc] Plugin not loaded: ${opts.pluginId}`)
      throw new Error(`Plugin not loaded: ${opts.pluginId}`)
    }

    const reqId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    console.log(`[contributionIpc] Sending contribution:execute:${opts.slot} to plugin '${opts.pluginId}' (reqId=${reqId})`)
    plugin.channel.sendToPlugin({
      id: reqId,
      type: `contribution:execute:${opts.slot}`,
      payload: {
        id: opts.id,
        name: opts.name || opts.id,
        args: opts.args || '',
        context: opts.context
      }
    })
  }

  const extensionListHandler = async () => {
    if (!loader) return []
    const installed = await loader.listInstalled()
    const loadedIds = new Set(host.listLoaded())
    return installed.map((manifest) => ({
      id: manifest.id,
      manifest,
      isLoaded: loadedIds.has(manifest.id)
    }))
  }

  const extensionInstallHandler = async (_event: unknown, scextPath: string) => {
    if (!loader) throw new Error('Loader not available')
    const manifest = await loader.install(scextPath)
    if (permissions) {
      permissions.registerPluginManifest(manifest.id, manifest.permissions)
    }
    await host.load(manifest.id)
    return { success: true, manifest }
  }

  const extensionUnloadHandler = async (_event: unknown, id: string) => {
    await host.unload(id)
    return { success: true }
  }

  const extensionReloadHandler = async (_event: unknown, id: string) => {
    await host.reload(id)
    return { success: true }
  }

  const extensionUninstallHandler = async (_event: unknown, id: string) => {
    await host.unload(id).catch(() => {})
    if (loader) {
      await loader.uninstall(id)
    }
    return { success: true }
  }

  const extensionGetLogHandler = async () => []

  ipcMain.handle('kernel:contributions:snapshot', snapshotHandler)
  ipcMain.handle('kernel:contribution:execute', executeHandler)
  ipcMain.handle('extension:list', extensionListHandler)
  ipcMain.handle('extension:install', extensionInstallHandler)
  ipcMain.handle('extension:unload', extensionUnloadHandler)
  ipcMain.handle('extension:reload', extensionReloadHandler)
  ipcMain.handle('extension:uninstall', extensionUninstallHandler)
  ipcMain.handle('extension:get-log', extensionGetLogHandler)

  const unsubscribeRegistry = registry.onChange(() => {
    syncAiTools()
    const wc = getWebContents ? getWebContents() : undefined
    if (wc) {
      const snapshot = getContributionSnapshot(registry, panelHost)
      wc.send('kernel:contributions:updated', snapshot)
    }
  })


  return () => {
    ipcMain.removeHandler('kernel:contributions:snapshot')
    ipcMain.removeHandler('kernel:contribution:execute')
    ipcMain.removeHandler('extension:list')
    ipcMain.removeHandler('extension:install')
    ipcMain.removeHandler('extension:unload')
    ipcMain.removeHandler('extension:reload')
    ipcMain.removeHandler('extension:uninstall')
    ipcMain.removeHandler('extension:get-log')
    unsubscribeRegistry()
    if (toolRegistry) {
      for (const name of registeredAiTools.keys()) {
        toolRegistry.unregisterTool(name)
      }
      registeredAiTools.clear()
    }
  }
}
