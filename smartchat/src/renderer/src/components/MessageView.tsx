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
  reactions?: Array<{
    senderId: string
    senderName?: string
    text: string
    timestamp: string
  }>
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

function ReactionsDisplay({ reactions, onClick }: { reactions?: MessageItem['reactions'], onClick: () => void }) {
  if (!reactions || reactions.length === 0) return null

  // Group by emoji
  const emojiCounts: Record<string, number> = {}
  for (const r of reactions) {
    emojiCounts[r.text] = (emojiCounts[r.text] || 0) + 1
  }

  const uniqueEmojis = Object.keys(emojiCounts)
  const totalCount = reactions.length

  return (
    <div className="message-reactions" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="reaction-bubbles-group">
        {uniqueEmojis.slice(0, 3).map((emoji) => (
          <span key={emoji} className="reaction-bubble-mini">
            {emoji}
          </span>
        ))}
      </div>
      {totalCount > 0 && (
        <span className="reaction-total-count">{totalCount}</span>
      )}
    </div>
  )
}

function ReactionDetailsModal({ message, onClose }: { message: MessageItem, onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="reaction-modal" onClick={e => e.stopPropagation()}>
        <div className="reaction-modal-header">
          <h3>Reactions</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="reaction-modal-list">
          {message.reactions?.sort((a,b) => parseInt(b.timestamp) - parseInt(a.timestamp)).map((r, i) => (
            <div key={i} className="reaction-modal-item">
              <div className="reaction-modal-user">
                <div className="user-avatar-mini">
                  {r.senderName?.charAt(0).toUpperCase() || '?'}
                </div>
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

export default function MessageView({ messages, loading, onLoadMore, onReply, onDownloadMedia }: MessageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [downloading, setDownloading] = useState<Record<string, boolean>>({})
  const [hasMore, setHasMore] = useState(true)
  const [viewingReactions, setViewingReactions] = useState<MessageItem | null>(null)
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
  
  const getThumbnailData = (media: any) => {
    if (!media || !media.jpegThumbnail) return undefined
    const thumb = media.jpegThumbnail
    if (typeof thumb === 'string') {
      return thumb.startsWith('data:') ? thumb : `data:image/jpeg;base64,${thumb}`
    }
    // Handle Buffer objects if they were stringified to JSON { type: 'Buffer', data: [...] }
    if (thumb && typeof thumb === 'object' && thumb.type === 'Buffer' && Array.isArray(thumb.data)) {
      const uint8 = new Uint8Array(thumb.data)
      let binary = ''
      for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i])
      return `data:image/jpeg;base64,${window.btoa(binary)}`
    }
    return undefined
  }

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

    const renderHighlightedText = (text: string, mentionsMap: Record<string, string> = {}) => {
      if (!text) return null
      // Match @[id], @id, or just @followed by word characters/digits
      const parts = text.split(/(@\[[\w.@-]+\]|@[\w.@-]+)/g)
      return (
        <>
          {parts.map((part, i) => {
            if (part.startsWith('@')) {
              let rawContent = part.substring(1)
              if (rawContent.startsWith('[') && rawContent.endsWith(']')) {
                rawContent = rawContent.substring(1, rawContent.length - 1)
              }
              
              let jid = rawContent
              // Check exact match first
              let name = mentionsMap[jid] || mentionsMap[rawContent]
              
              // If no exact match, try identifying by prefix (e.g. 12345 -> 12345@s.whatsapp.net)
              if (!name) {
                // Prioritize @s.whatsapp.net domain for numbers-only IDs
                if (/^\d+$/.test(rawContent)) {
                  name = mentionsMap[`${rawContent}@s.whatsapp.net`] || mentionsMap[`${rawContent}@lid`]
                }
              }

              // Final fallback: search all keys that start with rawContent
              if (!name) {
                const foundKey = Object.keys(mentionsMap).find(k => k.startsWith(rawContent))
                if (foundKey) {
                  name = mentionsMap[foundKey]
                }
              }

              if (name) {
                return (
                  <span key={i} className="message-mention" style={{ color: 'var(--primary, #00a884)', fontWeight: 600 }}>
                    @{name}
                  </span>
                )
              }
              return (
                <span key={i} className="message-mention" style={{ color: 'var(--primary, #00a884)', fontWeight: 600 }}>
                  {part}
                </span>
              )
            }
            return part
          })}
        </>
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
              <div className={`message-bubble ${msg.fromMe ? 'bubble-sent' : 'bubble-received'} ${msg.messageType === 'stickerMessage' ? 'bubble-sticker' : ''} ${msg.reactions && msg.reactions.length > 0 ? 'has-reactions' : ''}`}>
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

                  const quotedMentions = ctx?.quotedMessage ? 
                    (unwrapMessage(ctx.quotedMessage)?.extendedTextMessage?.contextInfo?.mentions || 
                     unwrapMessage(ctx.quotedMessage)?.contextInfo?.mentions || {}) : {}

                  const isImage = msg.messageType === 'imageMessage' || !!rawMsg?.imageMessage
                  const isSticker = msg.messageType === 'stickerMessage' || !!rawMsg?.stickerMessage
                  const isVideo = msg.messageType === 'videoMessage' || !!rawMsg?.videoMessage
                  const localURI = rawMsg?.imageMessage?.localURI || rawMsg?.stickerMessage?.localURI || rawMsg?.videoMessage?.localURI || (msg as any).localURI

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
                          <span style={{ color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {renderHighlightedText(quotedText, quotedMentions)}
                          </span>
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
                      
                      {isSticker && localURI && (
                        <div className="message-sticker">
                          <img 
                            src={localURI} 
                            alt="Sticker" 
                            style={{ cursor: 'pointer' }}
                            onClick={() => window.open(localURI)}
                          />
                        </div>
                      )}
                      
                      {isVideo && localURI && (
                        <div className="message-video" style={{ 
                          marginBottom: msg.textContent ? '8px' : '0',
                          borderRadius: '12px',
                          overflow: 'hidden',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          background: '#000',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          maxWidth: '400px',
                          width: '100%',
                          minWidth: '200px',
                          position: 'relative'
                        }}>
                          <video 
                            src={localURI} 
                            controls 
                            poster={getThumbnailData(rawMsg?.videoMessage)}
                            style={{ 
                              width: '100%',
                              maxWidth: '100%', 
                              maxHeight: '500px', 
                              display: 'block'
                            }}
                          />
                        </div>
                      )}

                      {(isImage || isSticker || isVideo) && !localURI && (
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
                           minWidth: '200px'
                        }}>
                          {downloading[msg.id] ? (
                            <div className="spinner-small" style={{ margin: '8px' }} />
                          ) : (
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ marginBottom: '12px' }}>
                                {isVideo ? (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="7" y1="3" x2="7" y2="10"/><line x1="17" y1="3" x2="17" y2="10"/><line x1="7" y1="10" x2="7" y2="17"/><line x1="17" y1="10" x2="17" y2="17"/></svg>
                                ) : (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                )}
                              </div>
                              <button
                                onClick={async () => {
                                  if (onDownloadMedia) {
                                    setDownloading(p => ({ ...p, [msg.id]: true }))
                                    try { await onDownloadMedia(msg.id) }
                                    finally { setDownloading(p => ({ ...p, [msg.id]: false })) }
                                  }
                                }}
                                style={{
                                  padding: '8px 16px',
                                  borderRadius: '16px',
                                  border: 'none',
                                  background: 'var(--primary, #00a884)',
                                  color: '#fff',
                                  fontWeight: 600,
                                  fontSize: '0.85rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '8px',
                                  width: '100%'
                                }}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                Download {isVideo ? 'Video' : (isSticker ? 'Sticker' : 'Image')}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {msg.textContent && (
                        <p className="message-text">
                          {renderHighlightedText(msg.textContent, ctx?.mentions)}
                        </p>
                      )}
                      {!msg.textContent && !isImage && !isSticker && !isVideo && (
                        <p className="message-text message-unsupported">
                          [{msg.messageType}]
                        </p>
                      )}
                    </>
                  )
                })()}
                
                <ReactionsDisplay reactions={msg.reactions} onClick={() => setViewingReactions(msg)} />
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
      
      {viewingReactions && (
        <ReactionDetailsModal 
          message={viewingReactions} 
          onClose={() => setViewingReactions(null)} 
        />
      )}
    </div>
  )
}
