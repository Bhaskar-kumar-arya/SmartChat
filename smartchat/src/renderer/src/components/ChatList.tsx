import { useState, useEffect } from 'react'
import { useChats } from '../hooks/useChats'
import { usePresence } from '../hooks/usePresence'
import { useSearch } from '../hooks/useSearch'
import { api } from '../services/api.service'
import { formatChatTime, isMuted } from '../utils/formatters'
import { ChatItem, SearchFilters, SearchMode } from '../types'
import { ProfilePicture } from './ProfilePicture'
import { SearchResultsPanel } from './SearchResultsPanel'
import { SearchFiltersPanel } from './SearchFiltersPanel'
import { useMemo } from 'react'

interface ChatListProps {
  activeJid: string | null
  onSelectChat: (jid: string, name: string, profilePictureUrl?: string | null, messageId?: string | null) => void
  onShowProfilePic: (jid: string, name: string) => void
}

export default function ChatList({ activeJid, onSelectChat, onShowProfilePic }: ChatListProps) {
  const { chats, allChats, loading, searchQuery, setSearchQuery, clearUnreadCount } = useChats(activeJid)
  const { presences } = usePresence()
  
  const [searchMode, setSearchMode] = useState<SearchMode>('normal')
  const [filters, setFilters] = useState<SearchFilters>({})
  const [showFilters, setShowFilters] = useState(false)
  const [indexingProgress, setIndexingProgress] = useState<number | null>(null)
  const [expandedCommunities, setExpandedCommunities] = useState<Set<string>>(new Set())

  const { results: searchResults, isSearching } = useSearch(searchQuery, searchMode, filters)

  const isSearchActive = searchQuery.trim().length > 0

  useEffect(() => {
    const unSub = api.onEmbeddingProgress((pct) => {
      setIndexingProgress(pct)
      if (pct === 100) {
        setTimeout(() => setIndexingProgress(null), 3000)
      }
    })
    return unSub
  }, [])

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

  const handleStartIndexing = async () => {
    if (confirm('Do you want to clear existing vectors before re-indexing? (Recommended when switching models)')) {
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

  // ── Hierarchy Logic ───────────────────────────────────────────────
  const { groupedChats, childrenByParent } = useMemo(() => {
    const roots: ChatItem[] = []
    const childrenByParent = new Map<string, ChatItem[]>()
    const processedJids = new Set<string>()
    
    // Pass 1: Identify all community roots and build children map
    chats.forEach(chat => {
      if (chat.isCommunity) {
        roots.push(chat)
        processedJids.add(chat.jid)
      } else if (chat.linkedParentJid) {
        // We'll process children later, but mark them as processed for standalone check
        const existing = childrenByParent.get(chat.linkedParentJid) || []
        childrenByParent.set(chat.linkedParentJid, [...existing, chat])
        processedJids.add(chat.jid)
      }
    })

    // Pass 2: Identify standalone chats
    const standaloneChats = chats.filter(chat => !processedJids.has(chat.jid))

    // Pass 3: Calculate effective timestamps for sortable items
    // Sortable items are either standalone chats OR community roots
    const sortableItems = [
      ...standaloneChats.map(chat => ({ 
        chat, 
        effectiveTimestamp: BigInt(chat.lastMessageTimestamp || chat.timestamp || 0) 
      })),
      ...roots.map(root => {
        const children = childrenByParent.get(root.jid) || []
        const timestamps = [
          BigInt(root.lastMessageTimestamp || root.timestamp || 0),
          ...children.map(c => BigInt(c.lastMessageTimestamp || c.timestamp || 0))
        ]
        return { 
          chat: root, 
          effectiveTimestamp: timestamps.reduce((max, curr) => curr > max ? curr : max, 0n)
        }
      })
    ]

    // Pass 4: Sort by effective timestamp descending
    sortableItems.sort((a, b) => {
      if (b.effectiveTimestamp > a.effectiveTimestamp) return 1
      if (b.effectiveTimestamp < a.effectiveTimestamp) return -1
      return 0
    })

    // Pass 5: Flatten for rendering
    const finalItems: (ChatItem & { isChild?: boolean; parentName?: string; totalUnreadCount?: number; children?: ChatItem[] })[] = []
    sortableItems.forEach(item => {
      const children = childrenByParent.get(item.chat.jid) || []
      
      if (item.chat.isCommunity) {
        const totalUnreadCount = children.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
        finalItems.push({ ...item.chat, totalUnreadCount, children })
        
        children.forEach(child => {
          finalItems.push({ ...child, isChild: true, parentName: item.chat.name })
        })
      } else {
        finalItems.push(item.chat)
      }
    })

    return { groupedChats: finalItems, childrenByParent }
  }, [chats])

  const toggleExpand = (jid: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setExpandedCommunities(prev => {
      const next = new Set(prev)
      if (next.has(jid)) next.delete(jid)
      else next.add(jid)
      return next
    })
  }

  const handleRootClick = (root: ChatItem) => {
    const isExpanded = expandedCommunities.has(root.jid)
    
    if (isExpanded) {
      // If already expanded, collapse it
      toggleExpand(root.jid)
    } else {
      const children = childrenByParent.get(root.jid) || []
      if (children.length > 0) {
        // Logic from user: open group with unread messages, otherwise first child
        const target = children.find(c => c.unreadCount > 0) || children[0]
        onSelectChat(target.jid, target.name, target.profilePictureUrl)
        if (target.unreadCount > 0) clearUnreadCount(target.jid)
        
        // Auto-expand when clicking root
        setExpandedCommunities(prev => {
          const next = new Set(prev)
          next.add(root.jid)
          return next
        })
      } else {
        // Regular group click if somehow it has no children
        onSelectChat(root.jid, root.name, root.profilePictureUrl)
      }
    }
  }
  // ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Chats</h1>
        <div className="header-actions">
          <button 
            className={`sparkle-btn ${indexingProgress !== null ? 'spinning' : ''}`}
            title="Index for Semantic Search"
            onClick={handleStartIndexing}
            disabled={indexingProgress !== null}
          >
            <span className="sparkle-icon">✦</span>
          </button>
          <button className="logout-button" title="Logout" onClick={handleLogout}>
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
        <div className="chat-list">
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
            groupedChats.map((chat) => {
              const muted = isMuted(chat.muteExpiration)
              const pinned = !!(chat.pinned && chat.pinned > 0)
              const presenceText = getPresenceText(chat)
              const isChild = (chat as any).isChild
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
                  style={isChild ? { paddingLeft: '32px', borderLeft: '2px solid var(--border-color, #eee)', marginLeft: '12px' } : {}}
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
                          {((chat as any).children || []).map((child: ChatItem) => (
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
                          {presenceText || chat.lastMessage || 'No messages'}
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
                        {((isRoot ? (chat as any).totalUnreadCount : chat.unreadCount) || 0) > 0 && (
                          <span className="chat-item-badge">
                            {isRoot ? (chat as any).totalUnreadCount : chat.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
