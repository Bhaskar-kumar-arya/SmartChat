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

export function registerContributionIpcHandlers(
  registry: IContributionRegistry,
  host: IPluginHost,
  getWebContents?: () => WebContents | undefined
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

  ipcMain.handle('kernel:contributions:snapshot', snapshotHandler)
  ipcMain.handle('kernel:contribution:execute', executeHandler)

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
    unsubscribeRegistry()
  }
}
