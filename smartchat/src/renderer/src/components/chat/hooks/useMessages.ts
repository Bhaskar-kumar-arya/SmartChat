import { useEffect, useState, useCallback, useRef } from 'react'
import { useAPI } from '../../../context/APIContext'
import { MessageItem, ReactionItem } from '../../../types/chatTypes'
import { isSameJid } from '../../../utils/jidUtils'

/**
 * Hook to manage messages for a specific chat.
 * Handles fetching, pagination, real-time updates (reactions, new msgs), 
 * and media download state.
 * This satisfies the Single Responsibility Principle.
 */
const PAGE_SIZE = 50

export const useMessages = (activeJid: string | null, initialTargetId?: string | null) => {
  const api = useAPI()
  const [messages, setMessages] = useState<MessageItem[]>([])
  const messagesRef = useRef<MessageItem[]>([])

  // Track the currently-active chat synchronously so async loads (getMessages /
  // getMessagesAround) can detect that they resolved after the user already
  // switched chats and bail instead of clobbering the new chat's list (F3-01/F3-02).
  const activeJidRef = useRef<string | null>(activeJid)
  activeJidRef.current = activeJid
  
  // Keep ref in sync without triggering hook dependencies
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const [loading, setLoading] = useState(false)
  const [isJumping, setIsJumping] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  // True after a jump: the list is a window in the middle of history and newer
  // messages exist beyond its last row. While set, live messages are NOT appended
  // (that would leave a silent gap); loadNewer / jumpToLatest fetch them instead.
  const [hasNewer, setHasNewerState] = useState(false)
  const hasNewerRef = useRef(false)
  const setHasNewer = useCallback((v: boolean) => {
    hasNewerRef.current = v
    setHasNewerState(v)
  }, [])
  const loadingNewerRef = useRef(false)
  // True while we've asked WhatsApp for an older page (the local DB is exhausted)
  // and are waiting for those messages to land. Surfaced to the UI as a spinner.
  const [syncingOlder, setSyncingOlder] = useState(false)

  // Guards a single in-flight on-demand history request. Holds the chat we're
  // trying to fill and a timeout that gives up if WhatsApp never answers.
  const onDemandRef = useRef<{ jid: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  const loadInitialMessages = useCallback(async (jid: string) => {
    setLoading(true)
    setHasMore(true)
    setHasNewer(false)
    loadingNewerRef.current = false
    // Drop any pending on-demand history request from the previous chat.
    if (onDemandRef.current) {
      clearTimeout(onDemandRef.current.timer)
      onDemandRef.current = null
    }
    setSyncingOlder(false)

    // Optimistic mark read
    api.markRead(jid).catch(err => console.error('Failed to mark read:', err))

    try {
      const msgs = await api.getMessages(jid, { limit: PAGE_SIZE })
      if (jid !== activeJidRef.current) return
      setMessages(msgs)
    } catch (err) {
      if (jid !== activeJidRef.current) return
      console.error('Failed to load messages:', err)
      setMessages([])
    } finally {
      if (jid === activeJidRef.current) setLoading(false)
    }
  }, [])

  const performJump = useCallback(async (jid: string, messageId: string) => {
    setIsJumping(true)
    try {
      const msgs = await api.getMessagesAround(jid, messageId)
      if (jid !== activeJidRef.current) return
      setMessages(msgs)
      setHasMore(true)
      // The window ends target+200 at most; whether newer rows exist is only known
      // by asking, so assume so until loadNewer reaches the end.
      setHasNewer(true)
      loadingNewerRef.current = false
      if (onDemandRef.current) {
        clearTimeout(onDemandRef.current.timer)
        onDemandRef.current = null
      }
      setSyncingOlder(false)
    } catch (err) {
      if (jid !== activeJidRef.current) return
      console.error('[useMessages] performJump failed, falling back:', err)
      await loadInitialMessages(jid)
    } finally {
      if (jid === activeJidRef.current) setIsJumping(false)
    }
  }, [api, loadInitialMessages, setHasNewer])

  const lastActiveJid = useRef<string | null>(null)

  useEffect(() => {
    if (activeJid !== lastActiveJid.current) {
      lastActiveJid.current = activeJid
      
      if (activeJid) {
        if (initialTargetId) {
          performJump(activeJid, initialTargetId)
        } else {
          loadInitialMessages(activeJid)
        }
      } else {
        setMessages([])
      }
    }
  }, [activeJid, initialTargetId, performJump, loadInitialMessages])

  const clearOnDemand = useCallback(() => {
    if (onDemandRef.current) {
      clearTimeout(onDemandRef.current.timer)
      onDemandRef.current = null
    }
    setSyncingOlder(false)
  }, [])

  /**
   * Prepend the stored page just older than the oldest loaded message (cursor, not
   * a page number, so it stays correct after a jump). Returns how many FRESH rows
   * landed (rows not already in the list).
   */
  const loadDbPage = useCallback(async (jid: string): Promise<number> => {
    const before = messagesRef.current[0]?.id
    const older = await api.getMessages(jid, { limit: PAGE_SIZE, before })
    // Bail if the user switched chats while this page was in flight, otherwise
    // chat A's older page gets prepended onto chat B's list (F3-02).
    if (jid !== activeJidRef.current) return 0
    const loaded = new Set(messagesRef.current.map((m) => m.id))
    const fresh = older.filter((m) => !loaded.has(m.id))
    if (fresh.length > 0) {
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        const add = fresh.filter((m) => !seen.has(m.id))
        return add.length > 0 ? [...add, ...prev] : prev
      })
    }
    return fresh.length
  }, [api])

  const loadMore = useCallback(async () => {
    if (!activeJid || !hasMore || loading) return 0
    // An on-demand fetch is already running for this chat — wait for it.
    if (onDemandRef.current) return 0

    const jid = activeJid
    try {
      const landed = await loadDbPage(jid)
      if (jid !== activeJidRef.current) return 0
      if (landed > 0) return landed

      // Local history exhausted — ask WhatsApp for an older page. The messages
      // arrive asynchronously via onWaHistoryAppended, which retries this page.
      const res = await api.fetchMessageHistory(jid)
      if (jid !== activeJidRef.current) return 0
      if (res.status !== 'requested') {
        // no-anchor (empty chat) or error / not connected — nothing more to show.
        setHasMore(false)
        return 0
      }
      setSyncingOlder(true)
      const timer = setTimeout(() => {
        // WhatsApp never answered. Clear the guard so a later scroll can retry;
        // keep hasMore true so the user isn't permanently capped.
        clearOnDemand()
      }, 40000)
      onDemandRef.current = { jid, timer }
      // Sentinel: an on-demand fetch is now in flight and a prepend will follow
      // asynchronously. The caller keeps its scroll-anchor state alive instead of
      // treating this as "no more messages".
      return -1
    } catch (err) {
      console.error('Failed to load more messages:', err)
      return 0
    }
  }, [activeJid, hasMore, loading, api, loadDbPage, clearOnDemand])

  // When an on-demand history page lands, retry the DB page we were trying to fill.
  useEffect(() => {
    const unSub = api.onWaHistoryAppended(() => {
      const pending = onDemandRef.current
      if (!pending || pending.jid !== activeJidRef.current) return
      clearOnDemand()
      loadDbPage(pending.jid).then((landed) => {
        if (pending.jid !== activeJidRef.current) return
        // WhatsApp acknowledged but returned nothing older — we've truly reached
        // the start of this conversation.
        if (landed === 0) setHasMore(false)
      })
    })
    return unSub
  }, [api, loadDbPage, clearOnDemand])

  /**
   * Replace the message list with a slice anchored at a specific message.
   * Uses the efficient backend query instead of paginating page-by-page.
   * Falls back to loadInitialMessages on error.
   */
  const jumpToMessage = useCallback(async (messageId: string) => {
    if (!activeJid) return
    
    // Optimization: If the message is already loaded in the DOM, 
    // skip the backend fetch and just let the UI scroll to it.
    if (messagesRef.current.some(m => m.id === messageId)) {
      return
    }
    
    await performJump(activeJid, messageId)
  }, [activeJid, performJump])

  /**
   * After a jump: append the page just newer than the last loaded message. Returns
   * how many fresh rows landed; clears `hasNewer` once the newest message is reached.
   */
  const loadNewer = useCallback(async (): Promise<number> => {
    const jid = activeJid
    if (!jid || !hasNewerRef.current || loadingNewerRef.current) return 0
    const list = messagesRef.current
    const after = list[list.length - 1]?.id
    if (!after) return 0
    loadingNewerRef.current = true
    try {
      const newer = await api.getMessages(jid, { limit: PAGE_SIZE, after })
      if (jid !== activeJidRef.current) return 0
      const loaded = new Set(messagesRef.current.map((m) => m.id))
      const fresh = newer.filter((m) => !loaded.has(m.id))
      if (fresh.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id))
          const add = fresh.filter((m) => !seen.has(m.id))
          return add.length > 0 ? [...prev, ...add] : prev
        })
      }
      if (newer.length < PAGE_SIZE) setHasNewer(false)
      return fresh.length
    } catch (err) {
      console.error('Failed to load newer messages:', err)
      return 0
    } finally {
      loadingNewerRef.current = false
    }
  }, [activeJid, api, setHasNewer])

  /** Drop a jumped window and reload the newest page (clears `hasNewer`). */
  const jumpToLatest = useCallback(async (): Promise<void> => {
    if (!activeJid) return
    await loadInitialMessages(activeJid)
  }, [activeJid, loadInitialMessages])

  /**
   * Add a message that the user just sent/retried to the list, unless the user has
   * moved on: a chat switch means it belongs to another list (B-UICHAT-02), and a
   * jumped window has no tail to append to, so reload the newest page instead.
   */
  const applyOwnMessage = (jid: string, msg: MessageItem, replaceId?: string): void => {
    if (jid !== activeJidRef.current) return
    if (hasNewerRef.current) {
      void loadInitialMessages(jid)
      return
    }
    setMessages((prev) => {
      const without = replaceId ? prev.filter((m) => m.id !== replaceId) : prev
      const idx = without.findIndex((m) => m.id === msg.id)
      if (idx !== -1) {
        const updated = [...without]
        updated[idx] = msg
        return updated
      }
      return [...without, msg]
    })
  }

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
      if (isSameJid(msg.chatJid, activeJid)) {
        if (msg.messageType === 'reactionMessage') {
          handleReactionUpdate(msg)
          return
        }

        // A jumped window has no tail: appending would leave a gap. loadNewer
        // picks this message up from the DB instead.
        if (hasNewerRef.current) return

        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) {
            return prev
          }
          return [...prev, msg]
        })
      }
    })

    const unSubEdit = api.onMessageEdited((msg: MessageItem) => {
      if (isSameJid(msg.chatJid, activeJid)) {
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)))
      }
    })

    const unSubDelete = api.onMessageDeleted((update: { id: string, chatJid: string, fromMe: boolean }) => {
      if (isSameJid(update.chatJid, activeJid)) {
        setMessages((prev) =>
          prev.map((m) => (m.id === update.id ? { ...m, isDeleted: true } : m))
        )
      }
    })

    const unSubStatus = api.onMessageStatusUpdated((update: { id: string, chatJid: string, status: string }) => {
      if (isSameJid(update.chatJid, activeJid)) {
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
    if (!msg.content) return
    try {
      const raw = JSON.parse(msg.content)
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
                const rx = r as ReactionItem & { participant?: string }
                if (rx.participant) return rx.participant !== participantKey
                return String(rx.senderId) !== String(participantKey)
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
      const jid = activeJid
      const sentMsg = await api.sendMessage(jid, text.trim(), replyId, mentions)
      applyOwnMessage(jid, sentMsg)
      return sentMsg
    } catch (err) {
      console.error('Failed to send message:', err)
      throw err
    }
  }

  const sendMediaMessage = async (filePath: string, text: string, replyId?: string, mentions?: string[]) => {
    if (!activeJid) return
    try {
      const jid = activeJid
      const sentMsg = await api.sendMediaMessage(jid, filePath, text.trim(), replyId, mentions)
      applyOwnMessage(jid, sentMsg)
      return sentMsg
    } catch (err) {
      console.error('Failed to send media message:', err)
      throw err
    }
  }

  const retryMessage = async (messageId: string): Promise<MessageItem | undefined> => {
    if (!activeJid) return
    try {
      const jid = activeJid
      const retried = await api.retryMessage(jid, messageId)
      // The retry is a brand-new message (new id): replace the failed bubble, tolerating the
      // live new-message event having already delivered it.
      applyOwnMessage(jid, retried, messageId)
      return retried
    } catch (err) {
      console.error('Failed to retry message:', err)
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
    isJumping,
    hasMore,
    hasNewer,
    syncingOlder,
    loadMore,
    loadNewer,
    jumpToLatest,
    loadInitialMessages,
    jumpToMessage,
    handleDownloadMedia,
    sendMessage,
    sendMediaMessage,
    retryMessage,
    editMessage,
    deleteMessage,
    setMessages
  }
}
