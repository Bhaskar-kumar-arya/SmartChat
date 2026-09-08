import { useState, useEffect } from 'react'
import { useAPI } from '../../context/APIContext'
import { useContributions } from '../../hooks/useContributions'
import { SettingsPluginPage } from '../panels/SettingsPluginPage'
import { BaseModal } from '../overlays/BaseModal'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const api = useAPI()
  const pluginSettingsPages = useContributions('settings-page')
  const [activeTab, setActiveTab] = useState<string>('general')
  const [prefs, setPrefs] = useState({
    enabled: true,
    soundEnabled: true,
    notifyWhenFocused: false,
    minimizeToTray: true,
    launchOnStartup: true
  })
  const [loading, setLoading] = useState(true)


  // F10-08: guard the async fetch against unmount / re-close, and show the
  // spinner again on every re-open instead of the previous session's values.
  useEffect(() => {
    if (!isOpen) return
    let alive = true
    setLoading(true)
    api.getNotificationPreferences()
      .then((data) => {
        if (!alive) return
        setPrefs(data)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        console.error('Failed to load notification preferences:', err)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isOpen, api])

  // F10-09: if the active plugin settings page disappears (plugin disabled while
  // the modal is open) fall back to the General tab instead of a blank body.
  useEffect(() => {
    if (activeTab === 'general') return
    if (!pluginSettingsPages.some((p) => p.id === activeTab)) {
      setActiveTab('general')
    }
  }, [activeTab, pluginSettingsPages])

  if (!isOpen) return null

  const handleToggle = async (key: keyof typeof prefs) => {
    const previous = prefs
    const updated = { ...prefs, [key]: !prefs[key] }
    setPrefs(updated)
    try {
      await api.setNotificationPreferences(updated)
    } catch (err) {
      // F10-06: the save failed — revert the optimistic toggle so the UI does
      // not claim a preference that was never persisted.
      console.error('Failed to save notification preferences:', err)
      setPrefs(previous)
    }
  }

  return (
    <BaseModal onClose={onClose} label="Settings" containerClassName="modal-container settings-modal">
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="modal-close-icon-btn" onClick={onClose} title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {pluginSettingsPages && pluginSettingsPages.length > 0 && (
          <div className="settings-tab-bar" style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--wa-border)', padding: '0 16px 8px 16px' }}>
            <button
              className={`settings-tab-btn ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
              style={{
                background: activeTab === 'general' ? 'var(--wa-bg-selected)' : 'transparent',
                color: activeTab === 'general' ? 'var(--wa-primary)' : 'var(--wa-text-secondary)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              General
            </button>
            {pluginSettingsPages.map((p) => (
              <button
                key={p.id}
                className={`settings-tab-btn ${activeTab === p.id ? 'active' : ''}`}
                onClick={() => setActiveTab(p.id)}
                style={{
                  background: activeTab === p.id ? 'var(--wa-bg-selected)' : 'transparent',
                  color: activeTab === p.id ? 'var(--wa-primary)' : 'var(--wa-text-secondary)',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="settings-loading">
            <div className="spinner" />
          </div>
        ) : activeTab !== 'general' ? (
          (() => {
            const activePage = pluginSettingsPages.find((p) => p.id === activeTab)
            if (!activePage) return null
            return (
              <div className="settings-scroll-content" style={{ padding: '16px' }}>
                <SettingsPluginPage pluginId={activePage.pluginId} contributionId={activePage.id} />
              </div>
            )
          })()
        ) : (
          <div className="settings-scroll-content">
            
            {/* Section: General */}

            <div className="settings-section">
              <h4 className="settings-section-title">General Settings</h4>
              <div className="settings-row">
                <span className="settings-label">Minimize to Tray on Close</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={prefs.minimizeToTray}
                  onChange={() => handleToggle('minimizeToTray')}
                />
              </div>
              <span className="settings-caption">
                When closed, keep SmartChat running in the system tray for background tasks and notifications.
              </span>

              <div className="settings-row">
                <span className="settings-label">Launch on Startup</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={prefs.launchOnStartup}
                  onChange={() => handleToggle('launchOnStartup')}
                />
              </div>
              <span className="settings-caption">
                Start the app automatically when you log in to your computer to receive real-time notifications in the background.
              </span>
            </div>

            {/* Section: Notifications */}
            <div>
              <h4 className="settings-section-title">Notifications</h4>
              
              <div className="settings-row">
                <span className="settings-label">Desktop Notifications</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={prefs.enabled}
                  onChange={() => handleToggle('enabled')}
                />
              </div>
              <span className="settings-caption">
                Show notifications for incoming chats.
              </span>

              <div className={`settings-row ${prefs.enabled ? '' : 'disabled'}`}>
                <span className="settings-label">Play Notification Sound</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={prefs.soundEnabled}
                  disabled={!prefs.enabled}
                  onChange={() => handleToggle('soundEnabled')}
                />
              </div>
              <span className={`settings-caption ${prefs.enabled ? '' : 'disabled'}`}>
                Play a sound alert when a new message arrives.
              </span>

              <div className={`settings-row ${prefs.enabled ? '' : 'disabled'}`}>
                <span className="settings-label">Notify Even When App is Focused</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={prefs.notifyWhenFocused}
                  disabled={!prefs.enabled}
                  onChange={() => handleToggle('notifyWhenFocused')}
                />
              </div>
              <span className={`settings-caption ${prefs.enabled ? '' : 'disabled'}`}>
                Show desktop notifications for other chats even when you are currently active in the application.
              </span>
            </div>

          </div>
        )}

        <button className="settings-save-btn" onClick={onClose}>
          Done
        </button>
    </BaseModal>
  )
}
