import { useEffect, useRef, useState, useMemo } from 'react'
import { MessageItem as IMessageItem } from '../types'
import { formatDate } from '../utils/formatters'
import MessageItem from './MessageItem'

interface MessageViewProps {
  messages: IMessageItem[]
  loading: boolean
  onLoadMore: () => Promise<number | undefined>
  onReply: (msg: IMessageItem) => void
  onDownloadMedia?: (msgId: string) => Promise<void>
  targetMessageId?: string | null
  onTargetScrolled?: () => void
}

export default function MessageView({ messages, loading, onLoadMore, onReply, onDownloadMedia, targetMessageId, onTargetScrolled }: MessageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [viewingReactions, setViewingReactions] = useState<IMessageItem | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const prevScrollHeight = useRef(0)
  const isLoadingRef = useRef(false)
  const prevMessageId = useRef<string | null>(null)
  const isInitialRenderForChat = useRef(true)
  const lastTargetId = useRef<string | null>(null)

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
    // If messages length changed or chat changed, we might have new messages
  }, [messages])

  // Scroll to bottom on new messages (unless we have a target)
  useEffect(() => {
    // If we have an active target message, skip auto-scroll to bottom
    if (targetMessageId) {
      lastTargetId.current = targetMessageId
      isInitialRenderForChat.current = false
      return
    }

    // If we just finished scrolling to a target (targetMessageId was just cleared), skip
    if (lastTargetId.current && !targetMessageId) {
      lastTargetId.current = null
      return
    }

    if (bottomRef.current && !loadingMore) {
      const behavior = isInitialRenderForChat.current ? 'auto' : 'smooth'
      bottomRef.current.scrollIntoView({ behavior })
      if (isInitialRenderForChat.current && messages.length > 0) {
        setTimeout(() => { isInitialRenderForChat.current = false }, 100)
      }
    }
  }, [messages.length, messages, targetMessageId]) 

  // Scroll to and highlight target message when it's available
  useEffect(() => {
    if (!targetMessageId || messages.length === 0) return

    // Wait a tick for DOM to settle
    const timer = setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-msg-id="${targetMessageId}"]`)
      if (el) {
        // Use auto behavior for first scroll to combat initial scroll interactions
        el.scrollIntoView({ behavior: 'auto', block: 'center' })
        setHighlightedId(targetMessageId)
        onTargetScrolled?.()

        // Remove highlight after animation
        setTimeout(() => setHighlightedId(null), 2500)
      } else {
        console.warn(`[MessageView] Target message ${targetMessageId} not found in DOM`)
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [targetMessageId, messages])

  // Restore scroll after loading older messages
  useEffect(() => {
    if (loadingMore && containerRef.current) {
      const newScrollHeight = containerRef.current.scrollHeight
      containerRef.current.scrollTop = newScrollHeight - prevScrollHeight.current
      setLoadingMore(false)
      isLoadingRef.current = false
    }
  }, [messages])

  const handleScroll = async () => {
    if (!containerRef.current || isLoadingRef.current || !hasMore || isInitialRenderForChat.current) return
    if (containerRef.current.scrollTop < 100) {
      isLoadingRef.current = true
      setLoadingMore(true)
      prevScrollHeight.current = containerRef.current.scrollHeight
      const count = await onLoadMore()
      if (!count || count === 0) {
        setHasMore(false)
        setLoadingMore(false)
        isLoadingRef.current = false
      }
    }
  }

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
    <div className="message-view" ref={containerRef} onScroll={handleScroll}>
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
                onReply={onReply} 
                onDownloadMedia={onDownloadMedia} 
                onViewReactions={(m) => setViewingReactions(m)} 
            />
          </div>
        ))
      )}

      <div ref={bottomRef} />
      
      {viewingReactions && (
        <ReactionDetailsModal message={viewingReactions} onClose={() => setViewingReactions(null)} />
      )}
    </div>
  )
}

function ReactionDetailsModal({ message, onClose }: { message: IMessageItem, onClose: () => void }) {
  const reactions = useMemo(() => {
    return (message.reactions || []).sort((a,b) => parseInt(b.timestamp) - parseInt(a.timestamp))
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
              <span className="reaction-modal-emoji">{r.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
