import { useEffect, useState, useCallback } from 'react'
import { api } from '../services/api.service'
import { MessageItem } from '../types'

/**
 * Hook to manage messages for a specific chat.
 * Handles fetching, pagination, real-time updates (reactions, new msgs), 
 * and media download state.
 * This satisfies the Single Responsibility Principle.
 */
export const useMessages = (activeJid: string | null) => {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const loadInitialMessages = useCallback(async (jid: string) => {
    setLoading(true)
    setCurrentPage(1)
    setHasMore(true)
    
    // Optimistic mark read
    api.markRead(jid).catch(err => console.error('Failed to mark read:', err))

    try {
      const msgs = await api.getMessages(jid, 1, 50)
      setMessages(msgs)
    } catch (err) {
      console.error('Failed to load messages:', err)
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeJid) {
      loadInitialMessages(activeJid)
    } else {
      setMessages([])
    }
  }, [activeJid, loadInitialMessages])

  const loadMore = useCallback(async () => {
    if (!activeJid || !hasMore || loading) return 0
    
    const nextPage = currentPage + 1
    try {
      const olderMsgs = await api.getMessages(activeJid, nextPage, 50)
      if (olderMsgs.length > 0) {
        setMessages((prev) => [...olderMsgs, ...prev])
        setCurrentPage(nextPage)
      } else {
        setHasMore(false)
      }
      return olderMsgs.length
    } catch (err) {
      console.error('Failed to load more messages:', err)
      return 0
    }
  }, [activeJid, currentPage, hasMore, loading])

  const handleDownloadMedia = async (msgId: string) => {
    try {
      const updatedMsg = await api.downloadMedia(msgId)
      setMessages((prev) => prev.map((m) => (m.id === msgId ? updatedMsg : m)))
    } catch (err) {
      console.error('Failed to download media:', err)
      throw err
    }
  }

  // Handle real-time updates
  useEffect(() => {
    if (!activeJid) return

    const unSub = api.onNewMessage((msg: MessageItem) => {
      if (msg.chatJid === activeJid) {
        if (msg.messageType === 'reactionMessage') {
          handleReactionUpdate(msg)
          return
        }

        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          return [...prev, msg]
        })
      }
    })

    const unSubEdit = api.onMessageEdited((msg: MessageItem) => {
      if (msg.chatJid === activeJid) {
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)))
      }
    })

    const unSubDelete = api.onMessageDeleted((update: { id: string, chatJid: string, fromMe: boolean }) => {
      if (update.chatJid === activeJid) {
        setMessages((prev) => 
          prev.map((m) => (m.id === update.id ? { ...m, isDeleted: true } : m))
        )
      }
    })

    const unSubStatus = api.onMessageStatusUpdated((update: { id: string, chatJid: string, status: string }) => {
      if (update.chatJid === activeJid) {
        setMessages((prev) => 
          prev.map((m) => (m.id === update.id ? { ...m, status: update.status } : m))
        )
      }
    })

    return () => {
      unSub()
      unSubEdit()
      unSubDelete()
      unSubStatus()
    }
  }, [activeJid])

  const handleReactionUpdate = (msg: MessageItem) => {
    try {
      const raw = JSON.parse(msg.content!)
      const reaction = raw.reactionMessage
      if (reaction && reaction.key && reaction.key.id) {
        const targetId = reaction.key.id
        const emoji = reaction.text
        // Use participant as the dedup key — this is a JID string in both
        // the IPC path (fromMe reactions sent by tool) and regular reaction events.
        const participantKey = msg.participant || msg.chatJid

        setMessages((prev) => 
          prev.map((m) => {
            if (m.id === targetId) {
              const reactions = m.reactions || []
              // Filter out any existing reaction from this participant.
              // Existing reactions from DB load may have numeric senderId; IPC ones use JID strings.
              // We match on participant (JID) — which is always present on incoming reaction msgs.
              const filtered = reactions.filter((r) => {
                // If the stored reaction also has a participant field, compare that
                if ((r as any).participant) return (r as any).participant !== participantKey
                // Otherwise fall back to senderId comparison (both string and number)
                return String(r.senderId) !== String(participantKey)
              })
              if (emoji) {
                return {
                  ...m,
                  reactions: [...filtered, {
                    senderId: participantKey,
                    senderName: msg.participantName,
                    text: emoji,
                    timestamp: msg.timestamp
                  }]
                }
              }
              return { ...m, reactions: filtered }
            }
            return m
          })
        )
      }
    } catch (e) {
      console.error('Failed to parse reaction message:', e)
    }
  }


  const sendMessage = async (text: string, replyId?: string, mentions?: string[]) => {
    if (!activeJid || !text.trim()) return
    try {
      const sentMsg = await api.sendMessage(activeJid, text.trim(), replyId, mentions)
      setMessages((prev) => [...prev, sentMsg])
      return sentMsg
    } catch (err) {
      console.error('Failed to send message:', err)
      throw err
    }
  }

  const sendMediaMessage = async (filePath: string, text: string, replyId?: string, mentions?: string[]) => {
    if (!activeJid) return
    try {
      const sentMsg = await api.sendMediaMessage(activeJid, filePath, text.trim(), replyId, mentions)
      setMessages((prev) => [...prev, sentMsg])
      return sentMsg
    } catch (err) {
      console.error('Failed to send media message:', err)
      throw err
    }
  }

  const editMessage = async (messageId: string, newText: string) => {
    if (!activeJid) return
    try {
      const updatedMsg = await api.editMessage(activeJid, messageId, newText)
      setMessages((prev) => prev.map((m) => (m.id === messageId ? updatedMsg : m)))
      return updatedMsg
    } catch (err) {
      console.error('Failed to edit message:', err)
      throw err
    }
  }

  const deleteMessage = async (messageId: string) => {
    if (!activeJid) return
    try {
      await api.deleteMessage(activeJid, messageId)
      setMessages((prev) => 
        prev.map((m) => (m.id === messageId ? { ...m, isDeleted: true } : m))
      )
    } catch (err) {
      console.error('Failed to delete message:', err)
      throw err
    }
  }

  return {
    messages,
    loading,
    hasMore,
    loadMore,
    handleDownloadMedia,
    sendMessage,
    sendMediaMessage,
    editMessage,
    deleteMessage,
    setMessages
  }
}
