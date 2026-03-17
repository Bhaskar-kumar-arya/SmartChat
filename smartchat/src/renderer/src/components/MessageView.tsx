import { useEffect, useRef, useState } from 'react'

interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  timestamp: string
  messageType: string
  textContent: string | null
}

interface MessageViewProps {
  messages: MessageItem[]
  loading: boolean
  onLoadMore: () => Promise<number | undefined>
}

export default function MessageView({ messages, loading, onLoadMore }: MessageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const prevScrollHeight = useRef(0)
  const isLoadingRef = useRef(false)
  const prevMessageId = useRef<string | null>(null)

  // Reset hasMore when switching chats (first message ID changes)
  useEffect(() => {
    const firstId = messages.length > 0 ? messages[0].id : null
    if (prevMessageId.current !== null && firstId !== prevMessageId.current) {
      // Only reset if this looks like a full chat switch (not prepend)
      if (messages.length <= 50) {
        setHasMore(true)
      }
    }
    prevMessageId.current = firstId
  }, [messages])

  // Auto-scroll to bottom when new messages arrive (not when loading older)
  useEffect(() => {
    if (bottomRef.current && !loadingMore) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  // Restore scroll position after loading older messages
  useEffect(() => {
    if (loadingMore && containerRef.current) {
      const newScrollHeight = containerRef.current.scrollHeight
      containerRef.current.scrollTop = newScrollHeight - prevScrollHeight.current
      setLoadingMore(false)
      isLoadingRef.current = false
    }
  }, [messages])

  const handleScroll = async () => {
    if (!containerRef.current || isLoadingRef.current || !hasMore) return

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
      // loadingMore will be set to false by the useEffect above after messages update
    }
  }

  const formatTime = (ts: string) => {
    try {
      const date = new Date(Number(ts) * 1000)
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  const formatDate = (ts: string) => {
    try {
      const date = new Date(Number(ts) * 1000)
      const now = new Date()
      if (date.toDateString() === now.toDateString()) return 'Today'
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
      return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    } catch {
      return ''
    }
  }

  // Group messages by date
  const getDateSeparators = () => {
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
  }

  const dateSeparators = getDateSeparators()

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
        <div className="message-empty">
          <p>No messages yet. Say hello! 👋</p>
        </div>
      ) : (
        messages.map((msg, idx) => (
          <div key={msg.id}>
            {dateSeparators.has(idx) && (
              <div className="date-separator">
                <span>{dateSeparators.get(idx)}</span>
              </div>
            )}
            <div className={`message-bubble-wrapper ${msg.fromMe ? 'sent' : 'received'}`}>
              <div className={`message-bubble ${msg.fromMe ? 'bubble-sent' : 'bubble-received'}`}>
                {msg.textContent ? (
                  <p className="message-text">{msg.textContent}</p>
                ) : (
                  <p className="message-text message-unsupported">
                    [{msg.messageType}]
                  </p>
                )}
                <span className="message-time">{formatTime(msg.timestamp)}</span>
              </div>
            </div>
          </div>
        ))
      )}

      <div ref={bottomRef} />
    </div>
  )
}
