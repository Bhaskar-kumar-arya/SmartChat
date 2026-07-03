import { useEffect, useState, useMemo, useRef } from 'react'
import { useAPI } from '../../../context/APIContext'
import { ChatItem, MessageItem } from '../../../types/chatTypes'
import { formatSenderName } from '../../../utils/formatters'
import { isSameJid } from '../../../utils/jidUtils'
import { formatMessagePreview } from '../../../utils/messagePreview'

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

    const unSubNewMsg = api.onNewMessage(async (msg: MessageItem) => {
      let reactionText = ''
      try {
        if (msg.messageType === 'reactionMessage' && msg.content) {
          const parsed = JSON.parse(msg.content)
          reactionText = parsed.reactionMessage?.text || ''
        }
      } catch (err) {
        console.warn('[useChats] Failed to parse reaction message:', err)
      }

      let targetMsgPreview = 'message'
      if (msg.targetMessageType) {
        const targetMockItem: MessageItem = {
          id: '',
          chatJid: msg.chatJid,
          fromMe: false,
          participant: null,
          timestamp: msg.timestamp,
          messageType: msg.targetMessageType,
          textContent: msg.targetTextContent || null
        }
        targetMsgPreview = formatMessagePreview(targetMockItem) || 'message'
      }

      const lastMessageText = msg.messageType === 'reactionMessage'
        ? `Reacted ${reactionText} to ${targetMsgPreview}`
        : formatMessagePreview(msg)

      const senderName = formatSenderName(msg.fromMe, msg.participantName, msg.participant)

      let hasChat = false
      setChats((prev) => {
        hasChat = prev.some((c) => isSameJid(c.jid, msg.chatJid))
        return prev
      })

      if (!hasChat) {
        try {
          const chatData = await api.getChat(msg.chatJid)
          if (chatData) {
            setChats((prev) => {
              const exists = prev.some((c) => isSameJid(c.jid, msg.chatJid))
              if (exists) {
                return prev.map((c) => {
                  if (!isSameJid(c.jid, msg.chatJid)) return c
                  return {
                    ...c,
                    unreadCount: msg.messageType === 'reactionMessage' ? c.unreadCount : (isSameJid(activeJidRef.current, msg.chatJid) ? 0 : c.unreadCount + (msg.fromMe ? 0 : 1)),
                    timestamp: msg.timestamp,
                    lastMessage: lastMessageText,
                    lastMessageType: msg.messageType,
                    lastMessageTimestamp: msg.timestamp,
                    lastMessageSender: senderName,
                    lastMessageStatus: msg.messageType === 'reactionMessage' ? null : (msg.status || null),
                    lastMessageFromMe: msg.fromMe,
                    lastMessageId: msg.id,
                    lastMessageTargetType: msg.messageType === 'reactionMessage' ? (msg.targetMessageType || null) : null,
                    lastMessageTargetText: msg.messageType === 'reactionMessage' ? targetMsgPreview : null,
                    lastMessageReactionText: msg.messageType === 'reactionMessage' ? reactionText : null
                  }
                })
              }
              
              const newChat: ChatItem = {
                ...chatData,
                unreadCount: isSameJid(activeJidRef.current, msg.chatJid) ? 0 : (msg.messageType === 'reactionMessage' ? (chatData.unreadCount || 0) : (chatData.unreadCount || 1)),
                timestamp: msg.timestamp,
                lastMessage: lastMessageText,
                lastMessageType: msg.messageType,
                lastMessageTimestamp: msg.timestamp,
                lastMessageSender: senderName,
                lastMessageStatus: msg.messageType === 'reactionMessage' ? null : (msg.status || null),
                lastMessageFromMe: msg.fromMe,
                lastMessageId: msg.id,
                lastMessageTargetType: msg.messageType === 'reactionMessage' ? (msg.targetMessageType || null) : null,
                lastMessageTargetText: msg.messageType === 'reactionMessage' ? targetMsgPreview : null,
                lastMessageReactionText: msg.messageType === 'reactionMessage' ? reactionText : null
              }

              return sortChats([newChat, ...prev])
            })
            return
          }
        } catch (err) {
          console.error('[useChats] Failed to fetch chat on new message:', err)
        }
      }

      setChats((prev) => {
        const idx = prev.findIndex((c) => isSameJid(c.jid, msg.chatJid))
        if (idx === -1 && !hasChat) {
          const isCurrentChat = isSameJid(activeJidRef.current, msg.chatJid)
          const fallbackChat: ChatItem = {
            jid: msg.chatJid,
            name: msg.chatJid.replace(/@.*$/, ''),
            unreadCount: isCurrentChat ? 0 : 1,
            timestamp: msg.timestamp,
            lastMessage: lastMessageText,
            lastMessageType: msg.messageType,
            lastMessageTimestamp: msg.timestamp,
            lastMessageSender: senderName,
            lastMessageStatus: msg.messageType === 'reactionMessage' ? null : (msg.status || null),
            lastMessageFromMe: msg.fromMe,
            lastMessageId: msg.id,
            lastMessageTargetType: msg.messageType === 'reactionMessage' ? (msg.targetMessageType || null) : null,
            lastMessageTargetText: msg.messageType === 'reactionMessage' ? targetMsgPreview : null,
            lastMessageReactionText: msg.messageType === 'reactionMessage' ? reactionText : null
          }
          return sortChats([fallbackChat, ...prev])
        }

        if (idx === -1) return prev

        const existing = prev[idx]
        const isCurrentChat = isSameJid(activeJidRef.current, msg.chatJid)

        const updatedChat: ChatItem = {
          ...existing,
          unreadCount: msg.messageType === 'reactionMessage' ? existing.unreadCount : (isCurrentChat ? 0 : existing.unreadCount + (msg.fromMe ? 0 : 1)),
          timestamp: msg.timestamp,
          lastMessage: lastMessageText,
          lastMessageType: msg.messageType,
          lastMessageTimestamp: msg.timestamp,
          lastMessageSender: senderName,
          lastMessageStatus: msg.messageType === 'reactionMessage' ? null : (msg.status || null),
          lastMessageFromMe: msg.fromMe,
          lastMessageId: msg.id,
          lastMessageTargetType: msg.messageType === 'reactionMessage' ? (msg.targetMessageType || null) : null,
          lastMessageTargetText: msg.messageType === 'reactionMessage' ? targetMsgPreview : null,
          lastMessageReactionText: msg.messageType === 'reactionMessage' ? reactionText : null
        }
        const filtered = prev.filter((c) => !isSameJid(c.jid, msg.chatJid))
        return sortChats([updatedChat, ...filtered])
      })
    })

    const unSubChatUpd = api.onChatUpdated(async (update) => {
      let hasChat = false
      setChats((prev) => {
        hasChat = prev.some((c) => isSameJid(c.jid, update.jid))
        return prev
      })

      if (!hasChat) {
        try {
          const chatData = await api.getChat(update.jid)
          if (chatData) {
            setChats((prev) => {
              const exists = prev.some((c) => isSameJid(c.jid, update.jid))
              if (exists) {
                return prev.map(c => isSameJid(c.jid, update.jid) ? { ...c, ...update } as ChatItem : c)
              }
              const newChat = { ...chatData, ...update } as ChatItem
              if (isSameJid(newChat.jid, activeJidRef.current)) {
                newChat.unreadCount = 0
              }
              return sortChats([newChat, ...prev])
            })
            return
          }
        } catch (err) {
          console.error('[useChats] Failed to fetch chat on update:', err)
        }
      }

      setChats((prev) => {
        const idx = prev.findIndex((c) => isSameJid(c.jid, update.jid))
        if (idx === -1) return prev
        
        const updatedChat = { ...prev[idx], ...update } as ChatItem
        if (isSameJid(updatedChat.jid, activeJidRef.current)) {
          updatedChat.unreadCount = 0
        }
        
        const filtered = prev.filter((c) => !isSameJid(c.jid, update.jid))
        return sortChats([updatedChat, ...filtered])
      })
    })

    const unSubMsgEdited = api.onMessageEdited((msg: MessageItem) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => isSameJid(c.jid, msg.chatJid))
        if (idx === -1) return prev

        const existing = prev[idx]
        const msgTs = BigInt(msg.timestamp || 0)
        const chatTs = BigInt(existing.lastMessageTimestamp || existing.timestamp || 0)

        // Only update preview if the edited message is the latest (or matches current last message timestamp)
        if (msgTs >= chatTs) {
          const lastMessageText = formatMessagePreview(msg)

          const updatedChat: ChatItem = {
            ...existing,
            lastMessage: lastMessageText,
            lastMessageType: msg.messageType,
            lastMessageSender: formatSenderName(msg.fromMe, msg.participantName, msg.participant),
            lastMessageStatus: msg.status || null,
            lastMessageFromMe: msg.fromMe,
            lastMessageId: msg.id
          }
          const filtered = prev.filter((c) => !isSameJid(c.jid, msg.chatJid))
          return sortChats([updatedChat, ...filtered])
        }
        return prev
      })
    })

    const unSubMsgStatus = api.onMessageStatusUpdated((update) => {
      setChats((prev) => {
        const idx = prev.findIndex((c) => isSameJid(c.jid, update.chatJid))
        if (idx === -1) return prev

        const existing = prev[idx]
        if (existing.lastMessageId === update.id) {
          const updatedChat = {
            ...existing,
            lastMessageStatus: update.status
          }
          const filtered = prev.filter((c) => !isSameJid(c.jid, update.chatJid))
          return sortChats([updatedChat, ...filtered])
        }
        return prev
      })
    })

    return () => {
      unSubNewMsg()
      unSubChatUpd()
      unSubMsgEdited()
      unSubMsgStatus()
    }
  }, []) // Dependency array empty ensures we only register once

  // Effect to optimistically clear unread count when switching chats
  useEffect(() => {
    if (activeJid) {
      setChats(prev => prev.map(c => 
        isSameJid(c.jid, activeJid) ? { ...c, unreadCount: 0 } : c
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
      isSameJid(c.jid, jid) ? { ...c, unreadCount: 0 } : c
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
