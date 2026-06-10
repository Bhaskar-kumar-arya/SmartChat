import { useState, useEffect } from 'react'
import { useChats } from '../../hooks/useChats'
import { usePresence } from '../../hooks/usePresence'
import { useSearch } from '../../hooks/useSearch'
import { useAPI } from '../../context/APIContext'
import { formatChatTime, isMuted } from '../../utils/formatters'
import { ChatItem, SearchFilters, SearchMode } from '../../types'
import { ProfilePicture } from '../common/ProfilePicture'
import { SearchResultsPanel } from './SearchResultsPanel'
import { SearchFiltersPanel } from './SearchFiltersPanel'
import { useChatHierarchy } from '../../hooks/useChatHierarchy'
import ConfirmModal from '../common/ConfirmModal'
import SettingsModal from '../common/SettingsModal'

interface ChatListProps {
  activeJid: string | null
  onSelectChat: (jid: string, name: string, profilePictureUrl?: string | null, messageId?: string | null) => void
  onShowProfilePic: (jid: string, name: string) => void
}

export default function ChatList({ activeJid, onSelectChat, onShowProfilePic }: ChatListProps) {
  const api = useAPI()
  const { 
    chats, 
    allChats, 
    loading, 
    loadingMore, 
    loadMore, 
    searchQuery, 
    setSearchQuery, 
    clearUnreadCount 
  } = useChats(activeJid)
  const { presences } = usePresence()

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const threshold = 50
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + threshold
    if (isAtBottom) {
      loadMore()
    }
  }
  
  const [searchMode, setSearchMode] = useState<SearchMode>('normal')
  const [filters, setFilters] = useState<SearchFilters>({})
  const [showFilters, setShowFilters] = useState(false)
  const [indexingProgress, setIndexingProgress] = useState<number | null>(null)
  const [isAiIndexing, setIsAiIndexing] = useState(false)
  
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showIndexConfirm, setShowIndexConfirm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [clearIndexFirst, setClearIndexFirst] = useState(false)

  const {
    groupedChats,
    expandedCommunities,
    toggleExpand,
    handleRootClick
  } = useChatHierarchy(chats, onSelectChat, clearUnreadCount)

  const { results: searchResults, isSearching } = useSearch(searchQuery, searchMode, filters)

  const isSearchActive = searchQuery.trim().length > 0

  useEffect(() => {
    const unSubPrg = api.onEmbeddingProgress((pct) => {
      setIndexingProgress(pct)
      if (pct === 100) {
        setTimeout(() => setIndexingProgress(null), 3000)
      }
    })
    const unSubState = api.onEmbeddingState((active) => {
      setIsAiIndexing(active)
    })
    return () => {
      unSubPrg()
      unSubState()
    }
  }, [])

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true)
  }

  const confirmLogout = async () => {
    setShowLogoutConfirm(false)
    try {
      await api.logout()
      window.location.reload()
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  const handleIndexClick = () => {
    setShowIndexConfirm(true)
  }

  const confirmIndex = async () => {
    setShowIndexConfirm(false)
    if (clearIndexFirst) {
      await api.clearVectors()
    }
    setIndexingProgress(0)
    try {
      await api.indexEmbeddings()
    } catch (err) {
      console.error('Indexing failed:', err)
      setIndexingProgress(null)
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

  const renderLastMessageText = (chat: ChatItem, presenceText: string | null) => {
    if (presenceText) return presenceText

    if (!chat.lastMessage && !chat.lastMessageType) {
      return 'No messages'
    }

    const iconStyle = { marginRight: '4px', display: 'inline', verticalAlign: 'middle' }

    switch (chat.lastMessageType) {
      case 'imageMessage':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <svg style={iconStyle} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            {chat.lastMessage || 'Photo'}
          </span>
        )
      case 'videoMessage':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <svg style={iconStyle} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            {chat.lastMessage || 'Video'}
          </span>
        )
      case 'stickerMessage':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <svg style={iconStyle} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            {chat.lastMessage || 'Sticker'}
          </span>
        )
      case 'audioMessage':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <svg style={iconStyle} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
            {chat.lastMessage || 'Voice message'}
          </span>
        )
      case 'documentMessage':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <svg style={iconStyle} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {chat.lastMessage || 'Document'}
          </span>
        )
      default:
        return chat.lastMessage || 'No messages'
    }
  }


  // Hierarchy state is managed by useChatHierarchy hook
  // ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Chats</h1>
        <div className="header-actions">
          <button 
            className={`sparkle-btn ${indexingProgress !== null ? 'spinning' : ''}`}
            title="Index for Semantic Search"
            onClick={handleIndexClick}
            disabled={indexingProgress !== null}
          >
            <span className="sparkle-icon">✦</span>
          </button>
          <button className="settings-button" title="Settings" onClick={() => setShowSettings(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button className="logout-button" title="Logout" onClick={handleLogoutClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="sidebar-search">
        <div className="search-input-wrapper">
          <svg className="search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search chats, contacts or messages"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button 
            className={`search-filter-toggle ${showFilters || Object.keys(filters).length > 0 ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
            title="Search Filters"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
          {isSearchActive && (
            <button className="search-clear-btn" onClick={() => setSearchQuery('')} title="Clear search">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {indexingProgress !== null && (
          <div className="indexing-bar-container">
            <div 
              className="indexing-bar-fill" 
              style={{ width: `${indexingProgress}%` }}
            />
            <span className="indexing-label">
              {indexingProgress < 100 ? `Indexing: ${indexingProgress}%` : 'Indexing Complete'}
            </span>
          </div>
        )}

        {isAiIndexing && indexingProgress === null && (
          <div style={{ padding: '0 12px 12px' }}>
            <div className="ai-indexing-tag">
              <div className="indexing-pulse-dot" />
              <span>AI Indexing active...</span>
            </div>
          </div>
        )}

        {showFilters && (
          <SearchFiltersPanel 
            filters={filters}
            onFiltersChange={setFilters}
            chats={allChats.map(c => ({ jid: c.jid, name: c.name }))}
            mode={searchMode}
            onModeChange={setSearchMode}
          />
        )}
      </div>

      {/* Render search results panel when searching, normal chat list otherwise */}
      {isSearchActive ? (
        <SearchResultsPanel
          chats={searchResults.chats}
          messages={searchResults.messages}
          isSearching={isSearching}
          query={searchQuery}
          activeJid={activeJid}
          mode={searchMode}
          onSelectChat={(jid, name, messageId) => onSelectChat(jid, name, undefined, messageId)}
        />
      ) : (
        <div className="chat-list" onScroll={handleScroll}>
          {loading ? (
            <div className="chat-list-loading">
              <div className="spinner" />
              <p>Loading chats...</p>
            </div>
          ) : chats.length === 0 ? (
            <div className="chat-list-empty">
              <p>No chats yet</p>
            </div>
          ) : (
            <>
              {groupedChats.map((chat) => {
                const muted = isMuted(chat.muteExpiration)
                const pinned = !!(chat.pinned && chat.pinned > 0)
                const presenceText = getPresenceText(chat)
                const isChild = chat.isChild
                const isRoot = chat.isCommunity
                
                // Hide children if parent is collapsed
                if (isChild && chat.linkedParentJid && !expandedCommunities.has(chat.linkedParentJid)) {
                  return null
                }

                const isExpanded = expandedCommunities.has(chat.jid)

                return (
                  <div
                    key={chat.jid}
                    className={`chat-list-item ${activeJid === chat.jid ? 'active' : ''} ${muted ? 'muted' : ''} ${isChild ? 'chat-child' : ''} ${isRoot ? 'chat-community-root' : ''}`}
                    onClick={() => {
                      if (isRoot) {
                        handleRootClick(chat)
                      } else {
                        onSelectChat(chat.jid, chat.name, chat.profilePictureUrl)
                        if (chat.unreadCount > 0) clearUnreadCount(chat.jid)
                      }
                    }}
                  >
                    <ProfilePicture 
                       jid={chat.jid} 
                       initialUrl={chat.profilePictureUrl} 
                       size={isChild ? 40 : 48} 
                       onClick={(e) => {
                         e.stopPropagation();
                         onShowProfilePic(chat.jid, chat.name);
                       }}
                    />
                    <div className="chat-item-content">
                      <div className="chat-item-top">
                        <span className="chat-item-name">
                          {isRoot && (
                            <button 
                              className={`community-toggle-btn ${isExpanded ? 'expanded' : ''}`}
                              onClick={(e) => toggleExpand(chat.jid, e)}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m9 18 6-6-6-6"/>
                              </svg>
                            </button>
                          )}
                          {chat.name}
                        </span>
                        <span className="chat-item-time">
                          {formatChatTime(chat.lastMessageTimestamp || chat.timestamp)}
                        </span>
                      </div>
                      <div className="chat-item-bottom">
                        {isRoot ? (
                          <div className="community-subgroups-preview">
                            {(chat.children || []).map((child: ChatItem) => (
                              <span 
                                key={child.jid} 
                                className={`subgroup-tag ${child.unreadCount > 0 ? 'has-unread' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onSelectChat(child.jid, child.name, child.profilePictureUrl)
                                }}
                              >
                                {child.unreadCount > 0 && <span className="unread-dot" />}
                                {child.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className={`chat-item-preview ${presenceText ? 'presence-typing' : ''}`}>
                            {isChild && chat.isAnnounce && <span className="announce-tag">[Announcement] </span>}
                            {renderLastMessageText(chat, presenceText)}
                          </span>
                        )}
                        
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
                          {((isRoot ? chat.totalUnreadCount : chat.unreadCount) || 0) > 0 && (
                            <span className="chat-item-badge">
                              {isRoot ? chat.totalUnreadCount : chat.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {loadingMore && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '16px 0' }}>
                  <div className="spinner-small" />
                  <span style={{ fontSize: '12px', color: 'var(--wa-text-secondary)' }}>Loading more...</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Logout and delete all data?"
        description="This will clear your local database, sync history, and active sessions. This action cannot be undone."
        confirmLabel="Logout"
        cancelLabel="Cancel"
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
        isDanger={true}
      />

      <ConfirmModal
        isOpen={showIndexConfirm}
        title="Index for Semantic Search"
        description="Index all chats and messages. This allows you to find relevant messages using natural language query embeddings."
        confirmLabel="Start Indexing"
        cancelLabel="Cancel"
        onConfirm={confirmIndex}
        onCancel={() => setShowIndexConfirm(false)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0' }}>
          <input
            type="checkbox"
            id="clear-vectors-checkbox"
            checked={clearIndexFirst}
            onChange={(e) => setClearIndexFirst(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label
            htmlFor="clear-vectors-checkbox"
            style={{ fontSize: '13px', color: 'var(--wa-text-primary)', cursor: 'pointer', userSelect: 'none' }}
          >
            Clear existing search index first (recommended when changing models)
          </label>
        </div>
      </ConfirmModal>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  )
}
