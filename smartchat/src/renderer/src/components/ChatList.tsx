import { useEffect, useState } from 'react'

interface ChatItem {
  jid: string
  name: string
  unreadCount: number
  timestamp: string
  lastMessage: string
  lastMessageTimestamp: string
  pinned?: number
  muteExpiration?: string
}

interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  participantName?: string | null
  timestamp: string
  messageType: string
  textContent: string | null
}

interface ChatListProps {
  activeJid: string | null
  onSelectChat: (jid: string, name: string) => void
}

export default function ChatList({ activeJid, onSelectChat }: ChatListProps) {
  const [chats, setChats] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [presences, setPresences] = useState<Record<string, any>>({})


  // Helper to sort chats: pinned first, then by timestamp
  const sortChats = (chatList: ChatItem[]) => {
    return [...chatList].sort((a, b) => {
      const pinA = a.pinned || 0
      const pinB = b.pinned || 0
      if (pinA > 0 && pinB <= 0) return -1
      if (pinB > 0 && pinA <= 0) return 1
      if (pinA > 0 && pinB > 0) return pinB - pinA

      const tsA = BigInt(a.lastMessageTimestamp || a.timestamp || 0)
      const tsB = BigInt(b.lastMessageTimestamp || b.timestamp || 0)
      if (tsB > tsA) return 1
      if (tsB < tsA) return -1
      return 0
    })
  }

  useEffect(() => {
    loadChats()

    const unSubNewMsg = window.api.onNewMessage((msg: MessageItem) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.jid === msg.remoteJid)
        const existing = idx >= 0 ? prev[idx] : null
        const updatedChat: ChatItem = {
          jid: msg.remoteJid,
          name: existing ? existing.name : msg.remoteJid.replace(/@.*$/, ''),
          unreadCount: existing ? (activeJid === msg.remoteJid ? 0 : existing.unreadCount + (msg.fromMe ? 0 : 1)) : (activeJid === msg.remoteJid ? 0 : 1),
          timestamp: msg.timestamp,
          lastMessage: msg.messageType === 'stickerMessage' ? 'Sticker' : (msg.textContent || `[${msg.messageType}]`),
          lastMessageTimestamp: msg.timestamp,
          pinned: existing?.pinned,
          muteExpiration: existing?.muteExpiration
        }
        const filtered = prev.filter((c) => c.jid !== msg.remoteJid)
        return sortChats([updatedChat, ...filtered])
      })
    })

    const unSubChatUpd = window.api.onChatUpdated((update) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.jid === update.jid)
        if (idx === -1) {
          loadChats()
          return prev
        }
        
        const updatedChat = { ...prev[idx], ...update }
        const filtered = prev.filter((c) => c.jid !== update.jid)
        return sortChats([updatedChat, ...filtered])
      })
    })

    return () => {
      unSubNewMsg()
      unSubChatUpd()
    }
  }, [activeJid])

  useEffect(() => {
    const unSubPresence = window.api.onPresenceUpdate((update) => {
      setPresences((prev) => ({
        ...prev,
        [update.remoteJid]: {
          ...(prev[update.remoteJid] || {}),
          ...update.presences
        }
      }))
    })
    return () => unSubPresence()
  }, [])

  const loadChats = async () => {
    try {
      const data = await window.api.getChats(1, 50)
      setChats(data)
    } catch (err) {
      console.error('Failed to load chats:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (ts: string) => {
    try {
      const date = new Date(Number(ts) * 1000)
      const now = new Date()
      const isToday = date.toDateString() === now.toDateString()
      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday'
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  const isMuted = (expiration?: string) => {
    if (!expiration) return false
    const expTime = Number(expiration) * 1000
    return expTime === -1000 || expTime > Date.now() // -1 is Baileys' way of saying forever
  }

  const filteredChats = searchQuery
    ? chats.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.jid.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : chats

  return (
    <div className="chat-sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Chats</h1>
        <button
          className="logout-button"
          title="Logout & delete all data"
          onClick={async () => {
            if (confirm('Logout and delete all data? This cannot be undone.')) {
              try {
                await window.api.logout()
                window.location.reload()
              } catch (err) {
                console.error('Logout failed:', err)
              }
            }
          }}
        >
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
        ) : filteredChats.length === 0 ? (
          <div className="chat-list-empty">
            <p>{searchQuery ? 'No matching chats' : 'No chats yet'}</p>
          </div>
        ) : (
          filteredChats.map((chat) => {
            const muted = isMuted(chat.muteExpiration)
            const pinned = chat.pinned && chat.pinned > 0

            return (
              <div
                key={chat.jid}
                className={`chat-list-item ${activeJid === chat.jid ? 'active' : ''} ${muted ? 'muted' : ''}`}
                onClick={async () => {
                  onSelectChat(chat.jid, chat.name)
                  // Optimistically clear unread badge in UI immediately
                  if (chat.unreadCount > 0) {
                    setChats(prev => prev.map(c => 
                      c.jid === chat.jid ? { ...c, unreadCount: 0 } : c
                    ))
                  }
                }}
              >
                <div className="chat-item-avatar">
                  {chat.name.charAt(0).toUpperCase()}
                </div>
                <div className="chat-item-content">
                  <div className="chat-item-top">
                    <span className="chat-item-name">{chat.name}</span>
                    <span className="chat-item-time">
                      {formatTime(chat.lastMessageTimestamp || chat.timestamp)}
                    </span>
                  </div>
                  <div className="chat-item-bottom">
                    <span className={`chat-item-preview ${(() => {
                        const presence = presences[chat.jid]
                        if(!presence) return ''
                        const statuses = Object.values(presence)
                        if (statuses.some((s: any) => s.lastKnownPresence === 'composing')) return 'presence-typing'
                        if (statuses.some((s: any) => s.lastKnownPresence === 'recording')) return 'presence-typing'
                        return ''
                    })()}`}>
                      {(() => {
                        const presence = presences[chat.jid]
                        if (presence) {
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
                        }
                        return chat.lastMessage || 'No messages'
                      })()}
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

