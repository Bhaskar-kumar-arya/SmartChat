import { useContributions } from '../../hooks/useContributions'
import { PluginIcon } from '../common/PluginIcon'

export interface SidebarRailProps {
  activeSidebarPanelId: string | null
  onSelectSidebarPanel: (id: string | null) => void
  onOpenSettings: () => void
  onOpenExtensionManager: () => void
  onIndexClick: () => void
  onLogoutClick: () => void
  indexingProgress: number | null
}

export function SidebarRail({
  activeSidebarPanelId,
  onSelectSidebarPanel,
  onOpenSettings,
  onOpenExtensionManager,
  onIndexClick,
  onLogoutClick,
  indexingProgress
}: SidebarRailProps) {
  const sidebarPanels = useContributions('sidebar-panel')

  return (
    <aside className="sidebar-rail">
      {/* Top Section */}
      <div className="sidebar-rail-top">
        {/* Main Chat List Icon */}
        <button
          className={`sidebar-rail-item ${activeSidebarPanelId === null ? 'active' : ''}`}
          onClick={() => onSelectSidebarPanel(null)}
          title="Chats"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Plugin Sidebar Panels */}
        {sidebarPanels && sidebarPanels.map((p) => {
          const isActive = p.id === activeSidebarPanelId
          return (
            <button
              key={p.id}
              className={`sidebar-rail-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSidebarPanel(p.id)}
              title={p.title}
            >
              <PluginIcon icon={p.icon} className="sidebar-rail-icon" />
            </button>
          )
        })}
      </div>

      {/* Bottom Section */}
      <div className="sidebar-rail-bottom">
        {/* Semantic Search Sparkle */}
        <button
          className={`sidebar-rail-item sparkle-btn ${indexingProgress !== null ? 'spinning' : ''}`}
          onClick={onIndexClick}
          disabled={indexingProgress !== null}
          title="Index for Semantic Search"
        >
          <span className="sparkle-icon" style={{ fontSize: '18px' }}>✦</span>
        </button>

        {/* Extension Manager */}
        <button
          className="sidebar-rail-item"
          onClick={onOpenExtensionManager}
          title="Extension Manager"
        >
          <span style={{ fontSize: '18px' }}>🧩</span>
        </button>

        {/* Settings */}
        <button
          className="sidebar-rail-item"
          onClick={onOpenSettings}
          title="Settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Logout */}
        <button
          className="sidebar-rail-item logout"
          onClick={onLogoutClick}
          title="Logout"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </aside>
  )
}
