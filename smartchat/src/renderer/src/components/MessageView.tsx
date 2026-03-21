import { useEffect, useRef, useState } from 'react'

interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  participantName?: string | null
  timestamp: string
  messageType: string
  textContent: string | null
  content?: string
}

function unwrapMessage(msg: any): any {
  if (!msg) return {}
  let unwrapped = msg
  if (unwrapped.ephemeralMessage) unwrapped = unwrapped.ephemeralMessage.message || unwrapped.ephemeralMessage
  if (unwrapped.viewOnceMessage) unwrapped = unwrapped.viewOnceMessage.message || unwrapped.viewOnceMessage
  if (unwrapped.viewOnceMessageV2) unwrapped = unwrapped.viewOnceMessageV2.message || unwrapped.viewOnceMessageV2
  if (unwrapped.viewOnceMessageV2Extension) unwrapped = unwrapped.viewOnceMessageV2Extension.message || unwrapped.viewOnceMessageV2Extension
  if (unwrapped.documentWithCaptionMessage) unwrapped = unwrapped.documentWithCaptionMessage.message || unwrapped.documentWithCaptionMessage
  return unwrapped
}

interface MessageViewProps {
  messages: MessageItem[]
  loading: boolean
  onLoadMore: () => Promise<number | undefined>
  onReply: (msg: MessageItem) => void
  onDownloadMedia?: (msgId: string) => Promise<void>
}

export default function MessageView({ messages, loading, onLoadMore, onReply, onDownloadMedia }: MessageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [downloading, setDownloading] = useState<Record<string, boolean>>({})
  const [hasMore, setHasMore] = useState(true)
  const prevScrollHeight = useRef(0)
  const isLoadingRef = useRef(false)
  const prevMessageId = useRef<string | null>(null)

  const isInitialRenderForChat = useRef(true)

  // Reset hasMore when switching chats (first message ID changes)
  useEffect(() => {
    const firstId = messages.length > 0 ? messages[0].id : null
    if (prevMessageId.current !== null && firstId !== prevMessageId.current) {
      // Only reset if this looks like a full chat switch (not prepend)
      if (messages.length <= 50) {
        setHasMore(true)
        isInitialRenderForChat.current = true
      }
    }
    prevMessageId.current = firstId
  }, [messages])

  // Auto-scroll to bottom when new messages arrive (not when loading older)
  useEffect(() => {
    if (bottomRef.current && !loadingMore) {
      const behavior = isInitialRenderForChat.current ? 'auto' : 'smooth'
      bottomRef.current.scrollIntoView({ behavior })
      
      // Delay unsetting the flag until after rendering
      if (isInitialRenderForChat.current && messages.length > 0) {
        setTimeout(() => {
          isInitialRenderForChat.current = false
        }, 100)
      }
    }
  }, [messages.length, messages])

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
                {!msg.fromMe && msg.participantName && (
                  <span className="message-sender-name" style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--primary, #00a884)',
                    marginBottom: '4px',
                    display: 'block'
                  }}>
                    {msg.participantName}
                  </span>
                )}
                {(() => {
                  let rawMsg: any = {}
                  try {
                    rawMsg = msg.content ? unwrapMessage(JSON.parse(msg.content)) : {}
                  } catch (e) {}
                  
                  // Extract quoted message context - check root and all common message type wrappers
                  const ctx = rawMsg?.extendedTextMessage?.contextInfo || 
                              rawMsg?.imageMessage?.contextInfo || 
                              rawMsg?.videoMessage?.contextInfo || 
                              rawMsg?.documentMessage?.contextInfo ||
                              rawMsg?.contextInfo
                  const isReply = !!ctx?.quotedMessage
                  
                  let quotedText = 'Media'
                  if (ctx?.quotedMessage) {
                    const q = unwrapMessage(ctx.quotedMessage)
                    quotedText = q.conversation || q.extendedTextMessage?.text || 'Media'
                  }

                  let quotedSender = ctx?.participantName || (ctx?.participant ? ctx.participant.split('@')[0] : 'Someone')

                  const isImage = msg.messageType === 'imageMessage' || !!rawMsg?.imageMessage
                  const localURI = rawMsg?.imageMessage?.localURI || (msg as any).localURI

                  return (
                    <>
                      {isReply && (
                        <div className="message-quote" style={{ 
                          backgroundColor: 'rgba(0,0,0,0.05)', 
                          padding: '4px 8px', 
                          borderLeft: '4px solid var(--primary, #00a884)', 
                          borderRadius: '4px',
                          marginBottom: '4px',
                          fontSize: '0.85rem'
                        }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--primary, #00a884)', display: 'block' }}>{quotedSender}</span>
                          <span style={{ color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{quotedText}</span>
                        </div>
                      )}
                      
                      {isImage && localURI && (
                        <div className="message-image" style={{ 
                          marginBottom: msg.textContent ? '8px' : '0',
                          borderRadius: '12px',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          background: 'rgba(0,0,0,0.05)',
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)'
                        }}
                        onClick={() => window.open(localURI)}>
                          <img 
                            src={localURI} 
                            alt="Media" 
                            style={{ 
                              maxWidth: '300px', 
                              maxHeight: '400px', 
                              objectFit: 'contain',
                              display: 'block'
                            }}
                          />
                        </div>
                      )}

                      {isImage && !localURI && (
                        <div className="message-image-download" style={{
                           marginBottom: msg.textContent ? '8px' : '0',
                           padding: '24px',
                           borderRadius: '12px',
                           background: 'var(--surface, rgba(0,0,0,0.05))',
                           border: '1px dashed var(--border, #ccc)',
                           display: 'flex',
                           flexDirection: 'column',
                           alignItems: 'center',
                           justifyContent: 'center',
                           gap: '8px',
                           minWidth: '150px'
                        }}>
                          {downloading[msg.id] ? (
                            <div className="spinner-small" style={{ margin: '8px' }} />
                          ) : (
                            <button
                              onClick={async () => {
                                if (onDownloadMedia) {
                                  setDownloading(p => ({ ...p, [msg.id]: true }))
                                  try { await onDownloadMedia(msg.id) }
                                  finally { setDownloading(p => ({ ...p, [msg.id]: false })) }
                                }
                              }}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '16px',
                                border: 'none',
                                background: 'var(--primary, #00a884)',
                                color: '#fff',
                                fontWeight: 600,
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                              Download Image
                            </button>
                          )}
                        </div>
                      )}
                      
                      {msg.textContent ? (
                        <p className="message-text">{msg.textContent}</p>
                      ) : (
                        !isImage && (
                          <p className="message-text message-unsupported">
                            [{msg.messageType}]
                          </p>
                        )
                      )}
                    </>
                  )
                })()}
                
                <span className="message-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="message-actions" style={{ display: 'flex', alignItems: 'center', opacity: 0.6, transition: 'opacity 0.2s', padding: '0 8px' }}>
                 <button onClick={() => onReply(msg)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px' }} title="Reply">
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v1.5"/></svg>
                 </button>
              </div>
            </div>
          </div>
        ))
      )}

      <div ref={bottomRef} />
    </div>
  )
}
