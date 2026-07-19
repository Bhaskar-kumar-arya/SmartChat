import { ExtensionManifest, SlashCommand } from '../../types/extension.types'

interface ExtensionCardProps {
  manifest: ExtensionManifest
  isLoaded: boolean
  isSelected: boolean
  onToggle: () => void
  onReload: () => void
  onUninstall: () => void
  onSelect: () => void
  onOpenChat?: () => void
}

export function ExtensionCard({
  manifest,
  isLoaded,
  isSelected,
  onToggle,
  onReload,
  onUninstall,
  onSelect,
  onOpenChat
}: ExtensionCardProps) {
  const emoji = manifest.dedicatedChat?.avatarEmoji ?? '🧩'
  const hasChat = !!manifest.dedicatedChat

  return (
    <div
      className={`ext-card ${isSelected ? 'ext-card--selected' : ''} ${!isLoaded ? 'ext-card--disabled' : ''}`}
      onClick={onSelect}
    >
      <div className="ext-card__header">
        <div className="ext-card__avatar">{emoji}</div>
        <div className="ext-card__info">
          <div className="ext-card__name">{manifest.name}</div>
          <div className="ext-card__version">v{manifest.version}</div>
        </div>
        <div className="ext-card__status">
          <span className={`ext-status-dot ${isLoaded ? 'ext-status-dot--active' : ''}`} />
        </div>
      </div>

      {manifest.description && (
        <p className="ext-card__description">{manifest.description}</p>
      )}

      {manifest.permissions.length > 0 && (
        <div className="ext-card__permissions">
          {manifest.permissions.slice(0, 4).map((perm) => (
            <span key={perm} className="ext-permission-badge">{perm}</span>
          ))}
          {manifest.permissions.length > 4 && (
            <span className="ext-permission-badge ext-permission-badge--more">
              +{manifest.permissions.length - 4}
            </span>
          )}
        </div>
      )}

      {manifest.dedicatedChat && (
        <div className="ext-card__commands">
          {(manifest.dedicatedChat.commands as SlashCommand[]).slice(0, 3).map((cmd) => (
            <span key={cmd.command} className="ext-command-chip">/{cmd.command}</span>
          ))}
        </div>
      )}

      <div className="ext-card__actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`ext-btn ${isLoaded ? 'ext-btn--danger' : 'ext-btn--primary'}`}
          onClick={onToggle}
          title={isLoaded ? 'Disable extension' : 'Enable extension'}
        >
          {isLoaded ? 'Disable' : 'Enable'}
        </button>
        {isLoaded && (
          <button
            className="ext-btn ext-btn--ghost"
            onClick={onReload}
            title="Reload extension"
          >
            ↺ Reload
          </button>
        )}
        <button
          className="ext-btn ext-btn--danger-ghost"
          style={{ padding: '0 8px' }}
          onClick={(e) => { e.stopPropagation(); onUninstall(); }}
          title="Uninstall extension"
        >
          🗑️
        </button>
        {isLoaded && hasChat && onOpenChat && (
          <button
            className="ext-btn ext-btn--ghost"
            onClick={onOpenChat}
            title="Open dedicated chat"
          >
            💬 Chat
          </button>
        )}
      </div>
    </div>
  )
}
