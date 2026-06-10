import { useState, useEffect } from 'react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [prefs, setPrefs] = useState({
    enabled: true,
    soundEnabled: true,
    notifyWhenFocused: false,
    minimizeToTray: true
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isOpen) {
      window.api.getNotificationPreferences()
        .then((data) => {
          setPrefs(data)
          setLoading(false)
        })
        .catch((err) => {
          console.error('Failed to load notification preferences:', err)
          setLoading(false)
        })
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleToggle = async (key: keyof typeof prefs) => {
    const updated = { ...prefs, [key]: !prefs[key] }
    setPrefs(updated)
    try {
      await window.api.setNotificationPreferences(updated)
    } catch (err) {
      console.error('Failed to save notification preferences:', err)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="modal-close-icon-btn" onClick={onClose} title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="settings-loading">
            <div className="spinner" />
          </div>
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
      </div>
    </div>
  )
}
