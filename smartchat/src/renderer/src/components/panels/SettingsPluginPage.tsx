import { useContributions } from '../../hooks/useContributions'
import { useContributionSnapshot } from '../../context/ContributionContext'
import { PanelWebview } from './PanelWebview'

export interface SettingsPluginPageProps {
  pluginId: string
  contributionId: string
}

export function SettingsPluginPage({ pluginId, contributionId }: SettingsPluginPageProps) {
  const settingsPages = useContributions('settings-page')
  const snapshot = useContributionSnapshot()
  const panelIds = snapshot.panelIds || {}

  const page = settingsPages.find(
    (p) => p.pluginId === pluginId && p.id === contributionId
  )

  if (!page || !page.panel) {
    return (
      <div className="settings-plugin-not-found" style={{ padding: '20px', color: 'var(--wa-text-secondary)' }}>
        No settings panel found for plugin &apos;{pluginId}&apos;.
      </div>
    )
  }

  const resolvedPanelId = panelIds[page.id] || page.id
  const panelUrl = `plugin://${pluginId}/${page.panel}`

  return (
    <div className="settings-plugin-page" style={{ width: '100%', height: '100%', minHeight: '350px' }}>
      <PanelWebview
        panelId={resolvedPanelId}
        pluginId={pluginId}
        panelUrl={panelUrl}
        visible={true}
        title={page.title}
      />
    </div>
  )
}
