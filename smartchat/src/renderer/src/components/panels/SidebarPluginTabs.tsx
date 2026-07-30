import { useState, useEffect, useCallback } from 'react'
import { useContributions } from '../../hooks/useContributions'
import { useContributionSnapshot } from '../../context/ContributionContext'
import { PluginIcon } from '../common/PluginIcon'
import { PanelWebview } from './PanelWebview'


interface SidebarPluginTabsProps {
  activePanelId: string | null
  onSelectPanel: (contributionId: string | null) => void
}

export function SidebarPluginNavItems({
  activePanelId,
  onSelectPanel
}: SidebarPluginTabsProps) {
  const panels = useContributions('sidebar-panel')

  if (!panels || panels.length === 0) return null

  return (
    <div className="sidebar-plugin-tabs">
      {panels.map((p) => {
        const isActive = p.id === activePanelId
        return (
          <button
            key={p.id}
            className={`plugin-tab-btn ${isActive ? 'active' : ''}`}
            title={p.title}
            onClick={() => onSelectPanel(isActive ? null : p.id)}
          >
            {p.icon ? (
              <PluginIcon icon={p.icon} />
            ) : (
              <span className="plugin-tab-fallback-icon">🧩</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export interface SidebarPluginMainStageProps {
  activePanelId: string | null
}

export function SidebarPluginMainStage({ activePanelId }: SidebarPluginMainStageProps) {
  const panels = useContributions('sidebar-panel')
  const snapshot = useContributionSnapshot()
  const panelIds = snapshot.panelIds || {}

  if (!panels || panels.length === 0) return null

  return (
    <div className="sidebar-plugin-main-stage" style={{ width: '100%', height: '100%' }}>
      {panels.map((p) => {
        const resolvedPanelId = panelIds[p.id] || p.id
        const panelUrl = p.panel ? `plugin://${p.pluginId}/${p.panel}` : ''
        const isVisible = p.id === activePanelId

        if (!panelUrl) {
          if (!isVisible) return null
          return (
            <div
              key={p.id}
              className="panel-placeholder"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',

                width: '100%',
                height: '100%',
                padding: '40px',
                color: 'var(--wa-text-primary)',
                background: 'var(--wa-bg-deep)',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧩</div>
              <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>{p.title}</h2>
              <p style={{ color: 'var(--wa-text-secondary)', maxWidth: '400px', fontSize: '14px', lineHeight: '1.5' }}>
                This plugin declared a sidebar panel contribution but did not specify a <code>panel</code> HTML file in its manifest.
              </p>
            </div>
          )
        }

        return (
          <PanelWebview
            key={p.id}
            panelId={resolvedPanelId}
            pluginId={p.pluginId}
            panelUrl={panelUrl}
            visible={isVisible}
            title={p.title}
          />
        )
      })}
    </div>

  )
}

export function useSidebarPanelFocus(
  onFocusChange?: (activeId: string | null) => void
) {
  const [activePanelId, setActivePanelId] = useState<string | null>(null)

  useEffect(() => {
    if (!window.api || typeof window.api.onPanelOpen !== 'function') return

    const unSubOpen = window.api.onPanelOpen(({ contributionId }) => {
      setActivePanelId(contributionId)
      onFocusChange?.(contributionId)
    })

    const unSubClose = window.api.onPanelClose(({ contributionId }) => {
      setActivePanelId((prev) => {
        const next = prev === contributionId ? null : prev
        onFocusChange?.(next)
        return next
      })
    })

    return () => {
      unSubOpen()
      unSubClose()
    }
  }, [onFocusChange])

  const selectPanel = useCallback((id: string | null) => {
    setActivePanelId(id)
    onFocusChange?.(id)
  }, [onFocusChange])

  return {
    activePanelId,
    selectPanel
  }
}
