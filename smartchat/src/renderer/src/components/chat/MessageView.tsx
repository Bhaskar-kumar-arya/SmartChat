import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Emoji, EmojiStyle } from 'emoji-picker-react'
import { MessageItem as IMessageItem } from '../../types/chatTypes'
import { formatDate } from '../../utils/formatters'
import MessageItem from './MessageItem'
import { emojiToUnified } from '../../utils/emojiUtils'

interface MessageViewProps {
  messages: IMessageItem[]
  loading: boolean
  isJumping?: boolean
  onLoadMore: () => Promise<number | undefined>
  onReply: (msg: IMessageItem) => void
  onEdit?: (messageId: string, newText: string) => Promise<any>
  onDelete?: (messageId: string) => Promise<any>
  onDownloadMedia?: (msgId: string) => Promise<void>
  targetMessageId?: string | null
  onTargetScrolled?: () => void
  onScrollToMessage?: (messageId: string) => void
  onSelectChat?: (jid: string, name: string) => void
}

export default function MessageView({
  messages,
  loading,
  isJumping = false,
  onLoadMore,
  onReply,
  onEdit,
  onDelete,
  onDownloadMedia,
  targetMessageId,
  onTargetScrolled,
  onScrollToMessage,
  onSelectChat
}: MessageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [viewingReactions, setViewingReactions] = useState<IMessageItem | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const prevScrollHeight = useRef(0)
  const isLoadingRef = useRef(false)
  const prevMessageId = useRef<string | null>(null)
  const isInitialRenderForChat = useRef(true)
  const lastTargetId = useRef<string | null>(null)
  const prevMessagesLength = useRef(messages.length)
  const prevLastMessageId = useRef<string | null>(messages.length > 0 ? messages[messages.length - 1].id : null)

  // Reset pagination state when switching chats
  useEffect(() => {
    const firstId = messages.length > 0 ? messages[0].id : null
    if (prevMessageId.current !== null && firstId !== prevMessageId.current) {
      if (messages.length <= 50) {
        setHasMore(true)
        isInitialRenderForChat.current = true
      }
    }
    prevMessageId.current = firstId
  }, [messages])

  // Scroll to bottom on new messages (unless we have a target)
  useEffect(() => {
    const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null
    const isNewMessage = messages.length > prevMessagesLength.current && lastMessageId !== prevLastMessageId.current

    prevMessagesLength.current = messages.length
    prevLastMessageId.current = lastMessageId

    if (targetMessageId) {
      lastTargetId.current = targetMessageId
      isInitialRenderForChat.current = false
      return
    }

    if (lastTargetId.current && !targetMessageId) {
      lastTargetId.current = null
      return
    }

    const shouldScroll = isInitialRenderForChat.current || isNewMessage

    if (shouldScroll && bottomRef.current && !loadingMore) {
      const behavior = isInitialRenderForChat.current ? 'auto' : 'smooth'
      bottomRef.current.scrollIntoView({ behavior })
      if (isInitialRenderForChat.current && messages.length > 0) {
        setTimeout(() => { isInitialRenderForChat.current = false }, 100)
      }
    }
  }, [messages, targetMessageId, loadingMore])

  // Scroll to and highlight target message when it's in the list
  useEffect(() => {
    if (!targetMessageId || messages.length === 0) return

    const timer = setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-msg-id="${targetMessageId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedId(targetMessageId)
        onTargetScrolled?.()
        setTimeout(() => setHighlightedId(null), 2500)
      } else {
        console.warn(`[MessageView] Target ${targetMessageId} not in DOM after jump`)
      }
    }, 120)

    return () => clearTimeout(timer)
  }, [targetMessageId, messages])

  // Restore scroll position after paginating older messages upward
  useEffect(() => {
    if (loadingMore && containerRef.current) {
      const newScrollHeight = containerRef.current.scrollHeight
      containerRef.current.scrollTop = newScrollHeight - prevScrollHeight.current
      setLoadingMore(false)
      isLoadingRef.current = false
    }
  }, [messages])

  // Track scroll position to show/hide the "Jump to Latest" button
  const handleScroll = useCallback(async () => {
    const el = containerRef.current
    if (!el) return

    // Show "Jump to Latest" when user is not near the bottom
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowJumpToLatest(distanceFromBottom > 300)

    // Paginate older messages when near the top
    if (el.scrollTop < 100 && !isLoadingRef.current && hasMore) {
      isLoadingRef.current = true
      setLoadingMore(true)
      prevScrollHeight.current = el.scrollHeight
      const count = await onLoadMore()
      if (!count || count === 0) {
        setHasMore(false)
        setLoadingMore(false)
        isLoadingRef.current = false
      }
    }
  }, [hasMore, onLoadMore])

  const handleReply = useCallback((msg: IMessageItem) => {
    onReply(msg)
  }, [onReply])

  const handleEdit = useCallback(async (messageId: string, newText: string) => {
    if (onEdit) await onEdit(messageId, newText)
  }, [onEdit])

  const handleDelete = useCallback(async (messageId: string) => {
    if (onDelete) await onDelete(messageId)
  }, [onDelete])

  const handleDownloadMedia = useCallback(async (msgId: string) => {
    if (onDownloadMedia) await onDownloadMedia(msgId)
  }, [onDownloadMedia])

  const handleViewReactions = useCallback((m: IMessageItem) => {
    setViewingReactions(m)
  }, [])

  const dateSeparators = useMemo(() => {
    const separators = new Map<number, string>()
    let lastDate = ''
    messages.forEach((msg, idx) => {
      const dateStr = formatDate(msg.timestamp)
      if (dateStr !== lastDate) {
        separators.set(idx, dateStr)
        lastDate = dateStr
      }
    })
    return separators
  }, [messages])

  if (loading) {
    return (
      <div className="message-view">
        <div className="message-loading">
          <div className="spinner" />
          <p>Loading messages...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="message-view" ref={containerRef} onScroll={handleScroll} style={{ position: 'relative' }}>
      {/* Inline loading shimmer while jumpToMessage is fetching — no jarring blank screen */}
      {isJumping && (
        <div className="message-jump-overlay">
          <div className="spinner" />
          <p>Loading message…</p>
        </div>
      )}

      {loadingMore && (
        <div className="message-loading-more">
          <div className="spinner-small" />
        </div>
      )}

      {messages.length === 0 ? (
        <div className="message-empty"><p>No messages yet. Say hello! 👋</p></div>
      ) : (
        messages.map((msg, idx) => (
          <div
            key={msg.id}
            data-msg-id={msg.id}
            className={highlightedId === msg.id ? 'msg-highlighted' : ''}
          >
            {dateSeparators.has(idx) && (
              <div className="date-separator"><span>{dateSeparators.get(idx)}</span></div>
            )}
            <MessageItem
              msg={msg}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDownloadMedia={handleDownloadMedia}
              onViewReactions={handleViewReactions}
              onScrollToMessage={onScrollToMessage}
              onSelectChat={onSelectChat}
            />
          </div>
        ))
      )}

      <div ref={bottomRef} />

      {/* "↓ Latest" floating pill — appears when scrolled away from newest messages */}
      {showJumpToLatest && (
        <button
          className="jump-to-latest-btn"
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          title="Jump to latest messages"
        >
          ↓ Latest
        </button>
      )}

      {viewingReactions && (
        <ReactionDetailsModal message={viewingReactions} onClose={() => setViewingReactions(null)} />
      )}
    </div>
  )
}

function ReactionDetailsModal({ message, onClose }: { message: IMessageItem, onClose: () => void }) {
  const reactions = useMemo(() => {
    return (message.reactions || []).sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp))
  }, [message.reactions])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="reaction-modal" onClick={e => e.stopPropagation()}>
        <div className="reaction-modal-header">
          <h3>Reactions</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="reaction-modal-list">
          {reactions.map((r, i) => (
            <div key={i} className="reaction-modal-item">
              <div className="reaction-modal-user">
                <div className="user-avatar-mini">{r.senderName?.charAt(0).toUpperCase() || '?'}</div>
                <div className="user-info-mini">
                  <span className="user-name-mini">{r.senderName || r.senderId.split('@')[0]}</span>
                  <span className="user-jid-mini">{r.senderId.split('@')[0]}</span>
                </div>
              </div>
              <span className="reaction-modal-emoji" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Emoji unified={emojiToUnified(r.text)} size={20} emojiStyle={EmojiStyle.APPLE} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
