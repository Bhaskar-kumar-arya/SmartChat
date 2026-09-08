import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPanelHost, PanelDescriptor } from './IPanelHost'
import { KernelNotFoundError } from '../api-modules/KernelErrors'

export class PanelHost implements IPanelHost {
  private readonly panels = new Map<string, PanelDescriptor>()

  constructor(private readonly getMainWindow?: () => BrowserWindow | null) {}

  registerPanel(desc: Omit<PanelDescriptor, 'panelId'>): string {
    const existing = this.findPanel(desc.pluginId, desc.contributionId)
    if (existing) {
      // Same (plugin, contribution) but the manifest now points the panel at a
      // different entry file (reload with a changed `panel` path) — replace the
      // stale descriptor instead of returning the old panelId. (S9-06)
      if (existing.panelPath !== desc.panelPath || existing.type !== desc.type) {
        this.panels.set(existing.panelId, { ...desc, panelId: existing.panelId })
      }
      return existing.panelId
    }

    const panelId = randomUUID()
    const fullDesc: PanelDescriptor = {
      ...desc,
      panelId
    }
    this.panels.set(panelId, fullDesc)
    return panelId
  }

  findPanel(pluginId: string, contributionId: string): PanelDescriptor | undefined {
    for (const panel of this.panels.values()) {
      if (panel.pluginId === pluginId && panel.contributionId === contributionId) {
        return panel
      }
    }
    return undefined
  }

  getPanel(panelId: string): PanelDescriptor | undefined {
    // Resolve strictly by the per-panel UUID. The old `contributionId` fallback
    // let a panel page send its author-chosen (non-unique) contribution id over
    // `kernel:panel:api` and be resolved to whichever plugin's descriptor
    // iterated first — running its kernel calls under another plugin's identity
    // and permission set. Callers that only have a contributionId must use
    // `findPanel(pluginId, contributionId)` with an explicit pluginId. (P2-S9-02)
    return this.panels.get(panelId)
  }

  getPluginId(panelId: string): string | undefined {
    return this.getPanel(panelId)?.pluginId
  }


  deregisterPlugin(pluginId: string): void {
    for (const [panelId, panel] of this.panels.entries()) {
      if (panel.pluginId === pluginId) {
        this.panels.delete(panelId)
      }
    }
  }

  async openPanel(pluginId: string, contributionId: string): Promise<{ success: boolean }> {
    const panel = this.findPanel(pluginId, contributionId)
    if (!panel) {
      throw new KernelNotFoundError(`Panel '${contributionId}' not found for plugin '${pluginId}'`)
    }
    const win = this.getMainWindow?.()
    if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())) {
      win.webContents.send('kernel:ui:panel:open', {
        contributionId,
        pluginId,
        panelId: panel.panelId
      })
    }
    return { success: true }
  }

  async closePanel(pluginId: string, contributionId: string): Promise<{ success: boolean }> {
    const win = this.getMainWindow?.()
    if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())) {
      win.webContents.send('kernel:ui:panel:close', {
        contributionId,
        pluginId
      })
    }
    return { success: true }
  }
}

