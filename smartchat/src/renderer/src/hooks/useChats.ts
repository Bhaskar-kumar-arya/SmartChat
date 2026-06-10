import { useEffect, useState, useMemo, useRef } from 'react'
import { useAPI } from '../context/APIContext'
import { ChatItem, MessageItem } from '../types'

/**
 * Helper to sort chats: pinned first, then by timestamp
 */
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

/**
 * Hook to manage the chat list, its filtering, and its real-time updates.
 * This satisfies the Single Responsibility Principle.
 */
export const useChats = (activeJid: string | null) => {
  const api = useAPI()
  const [chats, setChats] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  
  // Use a ref for activeJid so listeners always have the current value
  const activeJidRef = useRef(activeJid)
  useEffect(() => {
    activeJidRef.current = activeJid
  }, [activeJid])

  const loadChats = async (pageToLoad = 1, append = false) => {
    if (pageToLoad === 1) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    try {
      const pageSize = 50
      const data = await api.getChats(pageToLoad, pageSize)
      if (data.length < pageSize) {
        setHasMore(false)
      } else {
        setHasMore(true)
      }
      
      setChats((prev) => {
        if (append) {
          const existingJids = new Set(prev.map(c => c.jid))
          const filteredNew = data.filter(c => !existingJids.has(c.jid))
          return sortChats([...prev, ...filteredNew])
        }
        return data
      })
      setPage(pageToLoad)
    } catch (err) {
      console.error('Failed to load chats:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const loadMoreChats = async () => {
    if (loading || loadingMore || !hasMore) return
    await loadChats(page + 1, true)
  }

  useEffect(() => {
    loadChats(1, false)

    const unSubNewMsg = api.onNewMessage((msg: MessageItem) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.jid === msg.chatJid)
        const existing = idx >= 0 ? prev[idx] : null
        
        // Use ref value to avoid stale closures
        const isCurrentChat = activeJidRef.current === msg.chatJid
        
        let lastMessageText = ''
        if (msg.messageType === 'stickerMessage') {
          lastMessageText = 'Sticker'
        } else if (msg.messageType === 'imageMessage') {
          lastMessageText = msg.textContent || 'Photo'
        } else if (msg.messageType === 'videoMessage') {
          lastMessageText = msg.textContent || 'Video'
        } else if (msg.messageType === 'documentMessage') {
          lastMessageText = msg.textContent || 'Document'
        } else if (msg.messageType === 'audioMessage') {
          lastMessageText = 'Voice message'
        } else {
          lastMessageText = msg.textContent || (msg.messageType && msg.messageType !== 'unknown' ? `[${msg.messageType}]` : '')
        }

        const updatedChat: ChatItem = {
          ...(existing || {}),
          jid: msg.chatJid,
          name: existing ? existing.name : msg.chatJid.replace(/@.*$/, ''),
          unreadCount: existing 
            ? (isCurrentChat ? 0 : existing.unreadCount + (msg.fromMe ? 0 : 1)) 
            : (isCurrentChat ? 0 : 1),
          timestamp: msg.timestamp,
          lastMessage: lastMessageText,
          lastMessageType: msg.messageType,
          lastMessageTimestamp: msg.timestamp,
          pinned: existing?.pinned,
          muteExpiration: existing?.muteExpiration
        }
        const filtered = prev.filter((c) => c.jid !== msg.chatJid)
        return sortChats([updatedChat, ...filtered])
      })
    })

    const unSubChatUpd = api.onChatUpdated((update) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.jid === update.jid)
        if (idx === -1) {
          loadChats()
          return prev
        }
        
        const updatedChat = { ...prev[idx], ...update } as ChatItem
        // Keep unread 0 if it's the active chat
        if (updatedChat.jid === activeJidRef.current) {
          updatedChat.unreadCount = 0
        }
        
        const filtered = prev.filter((c) => c.jid !== update.jid)
        return sortChats([updatedChat, ...filtered])
      })
    })

    const unSubMsgEdited = api.onMessageEdited((msg: MessageItem) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.jid === msg.chatJid)
        if (idx === -1) return prev

        const existing = prev[idx]
        const msgTs = BigInt(msg.timestamp || 0)
        const chatTs = BigInt(existing.lastMessageTimestamp || existing.timestamp || 0)

        // Only update preview if the edited message is the latest (or matches current last message timestamp)
        if (msgTs >= chatTs) {
          let lastMessageText = ''
          if (msg.messageType === 'stickerMessage') {
            lastMessageText = 'Sticker'
          } else if (msg.messageType === 'imageMessage') {
            lastMessageText = msg.textContent || 'Photo'
          } else if (msg.messageType === 'videoMessage') {
            lastMessageText = msg.textContent || 'Video'
          } else if (msg.messageType === 'documentMessage') {
            lastMessageText = msg.textContent || 'Document'
          } else if (msg.messageType === 'audioMessage') {
            lastMessageText = 'Voice message'
          } else {
            lastMessageText = msg.textContent || (msg.messageType && msg.messageType !== 'unknown' ? `[${msg.messageType}]` : '')
          }

          const updatedChat: ChatItem = {
            ...existing,
            lastMessage: lastMessageText,
            lastMessageType: msg.messageType
          }
          const filtered = prev.filter((c) => c.jid !== msg.chatJid)
          return sortChats([updatedChat, ...filtered])
        }
        return prev
      })
    })

    return () => {
      unSubNewMsg()
      unSubChatUpd()
      unSubMsgEdited()
    }
  }, []) // Dependency array empty ensures we only register once

  // Effect to optimistically clear unread count when switching chats
  useEffect(() => {
    if (activeJid) {
      setChats(prev => prev.map(c => 
        c.jid === activeJid ? { ...c, unreadCount: 0 } : c
      ))
    }
  }, [activeJid])

  const filteredChats = useMemo(() => {
    if (!searchQuery) return chats
    const q = searchQuery.toLowerCase()
    return chats.filter(
      (c) => c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q)
    )
  }, [chats, searchQuery])

  const clearUnreadCount = (jid: string) => {
    setChats(prev => prev.map(c => 
      c.jid === jid ? { ...c, unreadCount: 0 } : c
    ))
  }

  return { 
    chats: filteredChats, 
    allChats: chats,
    loading, 
    loadingMore,
    hasMore,
    loadMore: loadMoreChats,
    searchQuery, 
    setSearchQuery,
    clearUnreadCount,
    reload: () => loadChats(1, false)
  }
}
