import { ipcMain, WebContents } from 'electron'
import { IContributionRegistry } from '../contributions/IContributionRegistry'
import { ContributionSlot } from '../contributions/ContributionPoints'
import { IPluginHost } from '../plugins/IPluginHost'

export function getContributionSnapshot(registry: IContributionRegistry): Record<string, unknown[]> {
  const slots: ContributionSlot[] = [
    'chat-action',
    'message-action',
    'chat-badge',
    'slash-command',
    'keyboard-shortcut',
    'status-bar-item',
    'chat-filter',
    'chat-sort-strategy',
    'completion-provider',
    'sidebar-panel',
    'settings-page',
    'ai-tool',
    'message-renderer',
    'message-send-pipeline',
    'plugin-api-export'
  ]

  const snapshot: Record<string, unknown[]> = {}
  for (const slot of slots) {
    snapshot[slot] = registry.getAll(slot)
  }
  return snapshot
}

import { PluginLoader } from '../plugins/PluginLoader'

export function registerContributionIpcHandlers(
  registry: IContributionRegistry,
  host: IPluginHost,
  getWebContents?: () => WebContents | undefined,
  loader?: PluginLoader
): () => void {
  const snapshotHandler = async () => {
    return getContributionSnapshot(registry)
  }

  const executeHandler = async (
    _event: unknown,
    opts: { slot: ContributionSlot; pluginId: string; id: string; context?: Record<string, unknown> }
  ) => {
    const plugin = host.getPlugin(opts.pluginId)
    if (!plugin) {
      throw new Error(`Plugin not loaded: ${opts.pluginId}`)
    }

    const reqId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    plugin.channel.sendToPlugin({
      id: reqId,
      type: `contribution:execute:${opts.slot}`,
      payload: {
        id: opts.id,
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
  ipcMain.handle('extension:getLog', extensionGetLogHandler)

  const unsubscribeRegistry = registry.onChange(() => {
    const wc = getWebContents ? getWebContents() : undefined
    if (wc) {
      const snapshot = getContributionSnapshot(registry)
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
    ipcMain.removeHandler('extension:getLog')
    unsubscribeRegistry()
  }
}
