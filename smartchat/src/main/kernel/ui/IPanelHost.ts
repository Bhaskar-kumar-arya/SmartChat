export interface PanelDescriptor {
  panelId: string
  contributionId: string
  pluginId: string
  panelPath: string
  type: 'sidebar' | 'settings'
}

export interface IPanelHost {
  registerPanel(desc: Omit<PanelDescriptor, 'panelId'>): string
  findPanel(pluginId: string, contributionId: string): PanelDescriptor | undefined
  getPanel(panelId: string): PanelDescriptor | undefined
  deregisterPlugin(pluginId: string): void
  getPluginId(panelId: string): string | undefined
  openPanel(pluginId: string, contributionId: string): Promise<{ success: boolean }>
  closePanel(pluginId: string, contributionId: string): Promise<{ success: boolean }>
}

