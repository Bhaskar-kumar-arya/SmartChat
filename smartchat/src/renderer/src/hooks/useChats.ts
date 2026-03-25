import { useEffect, useState, useMemo, useRef } from 'react'
import { api } from '../services/api.service'
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
  const [chats, setChats] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Use a ref for activeJid so listeners always have the current value
  const activeJidRef = useRef(activeJid)
  useEffect(() => {
    activeJidRef.current = activeJid
  }, [activeJid])

  const loadChats = async () => {
    try {
      const data = await api.getChats(1, 50)
      setChats(data)
    } catch (err) {
      console.error('Failed to load chats:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadChats()

    const unSubNewMsg = api.onNewMessage((msg: MessageItem) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.jid === msg.remoteJid)
        const existing = idx >= 0 ? prev[idx] : null
        
        // Use ref value to avoid stale closures
        const isCurrentChat = activeJidRef.current === msg.remoteJid
        
        const updatedChat: ChatItem = {
          jid: msg.remoteJid,
          name: existing ? existing.name : msg.remoteJid.replace(/@.*$/, ''),
          unreadCount: existing 
            ? (isCurrentChat ? 0 : existing.unreadCount + (msg.fromMe ? 0 : 1)) 
            : (isCurrentChat ? 0 : 1),
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

    return () => {
      unSubNewMsg()
      unSubChatUpd()
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
    searchQuery, 
    setSearchQuery,
    clearUnreadCount,
    reload: loadChats
  }
}
