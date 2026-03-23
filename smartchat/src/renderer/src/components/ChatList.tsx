import { useChats } from '../hooks/useChats'
import { usePresence } from '../hooks/usePresence'
import { api } from '../services/api.service'
import { formatChatTime, isMuted } from '../utils/formatters'
import { ChatItem } from '../types'

interface ChatListProps {
  activeJid: string | null
  onSelectChat: (jid: string, name: string) => void
}

export default function ChatList({ activeJid, onSelectChat }: ChatListProps) {
  const { chats, loading, searchQuery, setSearchQuery, clearUnreadCount } = useChats(activeJid)
  const { presences } = usePresence()

  const handleLogout = async () => {
    if (confirm('Logout and delete all data? This cannot be undone.')) {
      try {
        await api.logout()
        window.location.reload()
      } catch (err) {
        console.error('Logout failed:', err)
      }
    }
  }

  const getPresenceText = (chat: ChatItem) => {
    const presence = presences[chat.jid]
    if (!presence) return null
    const entries = Object.entries(presence) as [string, any][]
    const composing = entries.filter(([_, s]) => s.lastKnownPresence === 'composing')
    const recording = entries.filter(([_, s]) => s.lastKnownPresence === 'recording')
    
    if (composing.length > 0) {
      if (chat.jid.endsWith('@g.us')) {
        if (composing.length === 1) return `${composing[0][1].name || composing[0][0].split('@')[0]} typing...`
        return `${composing.length} typing...`
      }
      return 'typing...'
    }
    if (recording.length > 0) {
      if (chat.jid.endsWith('@g.us')) {
        if (recording.length === 1) return `${recording[0][1].name || recording[0][0].split('@')[0]} recording...`
        return `${recording.length} recording...`
      }
      return 'recording...'
    }
    return null
  }

  return (
    <div className="chat-sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Chats</h1>
        <button className="logout-button" title="Logout" onClick={handleLogout}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>

      <div className="sidebar-search">
        <div className="search-input-wrapper">
          <svg className="search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search or start new chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      <div className="chat-list">
        {loading ? (
          <div className="chat-list-loading">
            <div className="spinner" />
            <p>Loading chats...</p>
          </div>
        ) : chats.length === 0 ? (
          <div className="chat-list-empty">
            <p>{searchQuery ? 'No matching chats' : 'No chats yet'}</p>
          </div>
        ) : (
          chats.map((chat) => {
            const muted = isMuted(chat.muteExpiration)
            const pinned = !!(chat.pinned && chat.pinned > 0)
            const presenceText = getPresenceText(chat)

            return (
              <div
                key={chat.jid}
                className={`chat-list-item ${activeJid === chat.jid ? 'active' : ''} ${muted ? 'muted' : ''}`}
                onClick={() => {
                  onSelectChat(chat.jid, chat.name)
                  if (chat.unreadCount > 0) clearUnreadCount(chat.jid)
                }}
              >
                <div className="chat-item-avatar">
                  {chat.name.charAt(0).toUpperCase()}
                </div>
                <div className="chat-item-content">
                  <div className="chat-item-top">
                    <span className="chat-item-name">{chat.name}</span>
                    <span className="chat-item-time">
                      {formatChatTime(chat.lastMessageTimestamp || chat.timestamp)}
                    </span>
                  </div>
                  <div className="chat-item-bottom">
                    <span className={`chat-item-preview ${presenceText ? 'presence-typing' : ''}`}>
                      {presenceText || chat.lastMessage || 'No messages'}
                    </span>
                    <div className="chat-item-indicators">
                      {muted && (
                        <svg className="indicator-icon muted-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                          <line x1="23" y1="9" x2="17" y2="15"/>
                          <line x1="17" y1="9" x2="23" y2="15"/>
                        </svg>
                      )}
                      {pinned && (
                        <svg className="indicator-icon pin-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="17" x2="12" y2="22"/>
                          <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
                        </svg>
                      )}
                      {chat.unreadCount > 0 && (
                        <span className="chat-item-badge">{chat.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
