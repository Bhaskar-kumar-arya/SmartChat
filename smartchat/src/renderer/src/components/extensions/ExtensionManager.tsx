import { useState } from 'react'
import { useExtensionManager } from '../../hooks/useExtensionManager'
import { useAPI } from '../../context/APIContext'
import { ExtensionCard } from './ExtensionCard'
import { ExtensionLogViewer } from './ExtensionLogViewer'
import '../../styles/extension-manager.css'

interface ExtensionManagerProps {
  isOpen: boolean
  onClose: () => void
  onOpenExtensionChat?: (extensionId: string, name: string) => void
}

/**
 * Modal overlay following SettingsModal pattern.
 * Uses useExtensionManager() — zero direct api calls.
 */
export default function ExtensionManager({ isOpen, onClose, onOpenExtensionChat }: ExtensionManagerProps) {
  const api = useAPI()
  const { extensions, loading, error, install, unload, reload, uninstall } = useExtensionManager()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  if (!isOpen) return null

  const handleInstall = async () => {
    try {
      const paths = await api.selectFile()
      if (!paths || paths.length === 0) return
      setInstalling(true)
      await install(paths[0])
    } catch (err) {
      console.error('Failed to install extension:', err)
    } finally {
      setInstalling(false)
    }
  }

  const handleToggle = async (id: string, isLoaded: boolean) => {
    try {
      if (isLoaded) {
        await unload(id)
        if (selectedId === id) setSelectedId(null)
      } else {
        await reload(id)
      }
    } catch (err) {
      console.error('Failed to toggle extension:', err)
    }
  }

  return (
    <div className="ext-manager-overlay" onClick={onClose}>
      <div className="ext-manager-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ext-manager-header">
          <div className="ext-manager-title">
            <span className="ext-manager-icon">🧩</span>
            <h2>Extension Manager</h2>
          </div>
          <div className="ext-manager-header-actions">
            <button
              className="ext-install-btn"
              onClick={handleInstall}
              disabled={installing}
              title="Install .scext package"
            >
              {installing ? 'Installing…' : '+ Install'}
            </button>
            <button className="ext-close-btn" onClick={onClose} title="Close">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body: two-panel layout */}
        <div className="ext-manager-body">
          {/* Left panel: extension list */}
          <div className="ext-panel ext-panel--list">
            {loading ? (
              <div className="ext-panel-loading">
                <div className="spinner" />
                <span>Loading extensions…</span>
              </div>
            ) : error ? (
              <div className="ext-panel-error">{error}</div>
            ) : extensions.length === 0 ? (
              <div className="ext-panel-empty">
                <span className="ext-panel-empty-icon">🧩</span>
                <p>No extensions installed</p>
                <p className="ext-panel-empty-hint">Click <strong>+ Install</strong> to add a .scext file</p>
              </div>
            ) : (
              <div className="ext-card-list">
                {extensions.map((ext) => (
                  <ExtensionCard
                    key={ext.id}
                    manifest={ext.manifest}
                    isLoaded={ext.isLoaded}
                    isSelected={selectedId === ext.id}
                    onToggle={() => handleToggle(ext.id, ext.isLoaded)}
                    onReload={() => reload(ext.id)}
                    onUninstall={() => {
                      if (window.confirm(`Are you sure you want to uninstall ${ext.manifest.name} and clear its data?`)) {
                        uninstall(ext.id)
                        if (selectedId === ext.id) setSelectedId(null)
                      }
                    }}
                    onSelect={() => setSelectedId(ext.id === selectedId ? null : ext.id)}
                    onOpenChat={
                      ext.manifest.dedicatedChat && onOpenExtensionChat
                        ? () => {
                            onOpenExtensionChat(ext.id, ext.manifest.dedicatedChat!.name)
                            onClose()
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right panel: log viewer */}
          <div className="ext-panel ext-panel--log">
            <ExtensionLogViewer extensionId={selectedId} />
          </div>
        </div>
      </div>
    </div>
  )
}
