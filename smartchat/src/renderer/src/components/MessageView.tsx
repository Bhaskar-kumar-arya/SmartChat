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
}

export default function MessageView({ messages, loading, onLoadMore, onReply, onDownloadMedia }: MessageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [viewingReactions, setViewingReactions] = useState<IMessageItem | null>(null)
  const prevScrollHeight = useRef(0)
  const isLoadingRef = useRef(false)
  const prevMessageId = useRef<string | null>(null)
  const isInitialRenderForChat = useRef(true)

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

  // Scroll to bottom on new messages
  useEffect(() => {
    if (bottomRef.current && !loadingMore) {
      const behavior = isInitialRenderForChat.current ? 'auto' : 'smooth'
      bottomRef.current.scrollIntoView({ behavior })
      if (isInitialRenderForChat.current && messages.length > 0) {
        setTimeout(() => { isInitialRenderForChat.current = false }, 100)
      }
    }
  }, [messages.length, messages])

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
          <div key={msg.id}>
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
