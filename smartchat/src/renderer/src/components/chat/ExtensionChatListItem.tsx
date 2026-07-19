import { ExtendedChatItem } from '../../types/chat.types'

interface ExtensionChatListItemProps {
  chat: ExtendedChatItem // carries extensionEmoji, name, jid
  isActive: boolean
  onSelect: () => void
}

/**
 * LSP: satisfies the same render contract as regular chat items.
 * OCP: ChatList delegates to this instead of growing an inline branch.
 */
export function ExtensionChatListItem({ chat, isActive, onSelect }: ExtensionChatListItemProps) {
  const emoji = chat.extensionEmoji ?? '🧩'

  return (
    <div
      className={`chat-list-item extension-chat-item ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      title={chat.name}
    >
      <div className="extension-avatar" aria-label={`Extension: ${chat.name}`}>
        {emoji}
      </div>
      <div className="chat-item-content">
        <div className="chat-item-top">
          <span className="chat-item-name">{chat.name}</span>
          <span className="extension-badge">Extension</span>
        </div>
        <div className="chat-item-bottom">
          <span className="chat-item-preview chat-item-preview-text">
            {chat.lastMessage || 'Start a conversation…'}
          </span>
        </div>
      </div>
    </div>
  )
}
