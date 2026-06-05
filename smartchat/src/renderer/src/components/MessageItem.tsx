import { useState, useRef, useEffect } from 'react'
import { MessageItem as IMessageItem, ReactionItem, MessageReceiptInfo } from '../types'
import { formatTime } from '../utils/formatters'
import { TextMessage } from './messages/TextMessage'
import { ImageMessage, StickerMessage, VideoMessage, DocumentMessage, AudioMessage } from './messages/MediaMessages'
import { api } from '../services/api.service'

/**
 * Utility to unwrap metadata from Baileys messages.
 */
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

interface MessageItemProps {
  msg: IMessageItem
  onReply: (msg: IMessageItem) => void
  onEdit?: (messageId: string, newText: string) => Promise<void>
  onDelete?: (messageId: string) => Promise<void>
  onDownloadMedia?: (msgId: string) => Promise<void>
  onViewReactions: (msg: IMessageItem) => void
}

export default function MessageItem({ msg, onReply, onEdit, onDelete, onDownloadMedia, onViewReactions }: MessageItemProps) {
  const [downloading, setDownloading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(msg.textContent || '')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [receipts, setReceipts] = useState<MessageReceiptInfo[]>([])

  const handleShowInfo = async () => {
    setShowDropdown(false)
    try {
      const info = await api.getMessageReceipts(msg.id)
      setReceipts(info)
      setShowInfo(true)
    } catch (e) {
      console.error('Failed to load message receipts:', e)
    }
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleDownload = async () => {
    if (onDownloadMedia) {
      setDownloading(true)
      try { await onDownloadMedia(msg.id) }
      finally { setDownloading(false) }
    }
  }

  const handleSaveEdit = async () => {
    if (onEdit && editText.trim() !== msg.textContent && editText.trim()) {
      await onEdit(msg.id, editText.trim())
    }
    setIsEditing(false)
    setShowDropdown(false)
  }

  const handleDelete = async () => {
    if (onDelete && window.confirm('Delete this message for everyone?')) {
      await onDelete(msg.id)
    }
    setShowDropdown(false)
  }

  let rawMsg: any = {}
  try {
    rawMsg = msg.content ? unwrapMessage(JSON.parse(msg.content)) : {}
  } catch (e) {}

  const ctx = rawMsg?.extendedTextMessage?.contextInfo || 
              rawMsg?.imageMessage?.contextInfo || 
              rawMsg?.videoMessage?.contextInfo || 
              rawMsg?.documentMessage?.contextInfo ||
              rawMsg?.audioMessage?.contextInfo ||
              rawMsg?.contextInfo
  
  const isReply = !!ctx?.quotedMessage
  let quotedText = 'Media'
  let quotedMentions = {}
  if (ctx?.quotedMessage) {
    const q = unwrapMessage(ctx.quotedMessage)
    quotedText = q.conversation || q.extendedTextMessage?.text || 'Media'
    quotedMentions = q.extendedTextMessage?.contextInfo?.mentions || q.contextInfo?.mentions || {}
  }
  const quotedSender = ctx?.participantName || (ctx?.participant ? ctx.participant.split('@')[0] : 'Someone')

  const isImage = msg.messageType === 'imageMessage' || !!rawMsg?.imageMessage
  const isSticker = msg.messageType === 'stickerMessage' || !!rawMsg?.stickerMessage
  const isVideo = msg.messageType === 'videoMessage' || !!rawMsg?.videoMessage
  const isDocument = msg.messageType === 'documentMessage' || !!rawMsg?.documentMessage
  const isAudio = msg.messageType === 'audioMessage' || !!rawMsg?.audioMessage
  const localURI = rawMsg?.imageMessage?.localURI || rawMsg?.stickerMessage?.localURI || rawMsg?.videoMessage?.localURI || rawMsg?.documentMessage?.localURI || rawMsg?.audioMessage?.localURI || msg.localURI

  const isTextMessage = msg.messageType === 'conversation' || msg.messageType === 'extendedTextMessage'
  const canEdit = msg.fromMe && isTextMessage && !msg.isDeleted
  const canDelete = msg.fromMe && !msg.isDeleted

  const renderContent = () => {
    if (msg.isDeleted && msg.fromMe) {
      return (
        <div className="message-deleted-badge">
           <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
           <span className="message-deleted-text">You deleted this message</span>
        </div>
      )
    }

    if (isEditing) {
      return (
        <div className="message-edit-container">
          <textarea 
            className="message-edit-input" 
            value={editText} 
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
              if (e.key === 'Escape') setIsEditing(false);
            }}
            autoFocus 
          />
          <div className="message-edit-actions">
            <button className="edit-btn edit-btn-cancel" onClick={() => setIsEditing(false)}>Cancel</button>
            <button className="edit-btn edit-btn-save" onClick={handleSaveEdit}>Save</button>
          </div>
        </div>
      )
    }

    return (
      <div className="message-content-vertical">
        {msg.isDeleted && !msg.fromMe && (
          <div className="message-deleted-badge">
             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
             <span className="message-deleted-text">This message was deleted</span>
          </div>
        )}
        
        {isImage && <ImageMessage localURI={localURI} textContent={msg.textContent} onDownload={handleDownload} isDownloading={downloading} />}
        {isSticker && <StickerMessage localURI={localURI} onDownload={handleDownload} isDownloading={downloading} />}
        {isVideo && <VideoMessage localURI={localURI} textContent={msg.textContent} rawMsg={rawMsg} onDownload={handleDownload} isDownloading={downloading} />}
        {isDocument && <DocumentMessage localURI={localURI} textContent={msg.textContent} rawMsg={rawMsg} onDownload={handleDownload} isDownloading={downloading} />}
        {isAudio && <AudioMessage localURI={localURI} senderJid={msg.participant || msg.chatJid} onDownload={handleDownload} isDownloading={downloading} rawMsg={rawMsg} />}
        {isTextMessage && msg.textContent && <TextMessage text={msg.textContent} mentions={ctx?.mentions} />}
        {!isImage && !isSticker && !isVideo && !isDocument && !isAudio && !isTextMessage && (
          <p className="message-text message-unsupported">[{msg.messageType}]</p>
        )}
      </div>
    )
  }

  return (
    <div className={`message-bubble-wrapper ${msg.fromMe ? 'sent' : 'received'}`}>
      <div className={`message-bubble ${msg.fromMe ? 'bubble-sent' : 'bubble-received'} ${msg.messageType === 'stickerMessage' ? 'bubble-sticker' : ''} ${msg.reactions && msg.reactions.length > 0 ? 'has-reactions' : ''}`}>
        {!msg.fromMe && msg.participantName && (
          <span className="message-sender-name">
            {msg.participantName}
          </span>
        )}

        {isReply && (
          <div className="message-quote">
            <span className="quote-sender">{quotedSender}</span>
            <div className="quote-text">
                <TextMessage text={quotedText} mentions={quotedMentions} />
            </div>
          </div>
        )}

        {renderContent()}

        {msg.textContent && !isTextMessage && isImage && <TextMessage text={msg.textContent} mentions={ctx?.mentions} />}
        {msg.textContent && !isTextMessage && isVideo && <TextMessage text={msg.textContent} mentions={ctx?.mentions} />}
        {msg.textContent && !isTextMessage && isDocument && <TextMessage text={msg.textContent} mentions={ctx?.mentions} />}

        <ReactionsDisplay reactions={msg.reactions} onClick={() => onViewReactions(msg)} />
        <span className="message-time" style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          {formatTime(msg.timestamp)}
          {msg.isEdited && <span className="message-edited-badge">(edited)</span>}
          {msg.fromMe && renderStatusTicks(msg.status)}
        </span>
      </div>
      
      <div className="message-actions">
        <div className="message-dropdown-container" ref={dropdownRef}>
          <button className="action-btn" onClick={() => setShowDropdown(!showDropdown)} title="Message Options">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
          
          {showDropdown && (
            <div className="dropdown-menu">
              <button className="dropdown-item" onClick={() => { onReply(msg); setShowDropdown(false); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v1.5"/></svg>
                Reply
              </button>
              {msg.fromMe && (
                <button className="dropdown-item" onClick={handleShowInfo}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  Info
                </button>
              )}
              {canEdit && (
                <button className="dropdown-item" onClick={() => { setIsEditing(true); setShowDropdown(false); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </button>
              )}
              {canDelete && (
                <button className="dropdown-item delete" onClick={handleDelete}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showInfo && (
        <MessageInfoModal receipts={receipts} onClose={() => setShowInfo(false)} />
      )}
    </div>
  )
}

function ReactionsDisplay({ reactions, onClick }: { reactions?: ReactionItem[], onClick: () => void }) {
  if (!reactions || reactions.length === 0) return null
  const emojiCounts: Record<string, number> = {}
  for (const r of reactions) emojiCounts[r.text] = (emojiCounts[r.text] || 0) + 1
  const uniqueEmojis = Object.keys(emojiCounts)
  return (
    <div className="message-reactions" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="reaction-bubbles-group">
        {uniqueEmojis.slice(0, 3).map((emoji) => (
          <span key={emoji} className="reaction-bubble-mini">{emoji}</span>
        ))}
      </div>
      {reactions.length > 0 && <span className="reaction-total-count">{reactions.length}</span>}
    </div>
  )
}

function renderStatusTicks(status?: string) {
  const normalized = status || 'SENT'
  
  if (normalized === 'PENDING') {
    return (
      <span className="msg-status-tick" title="Pending" style={{ display: 'inline-flex', alignSelf: 'center', marginLeft: '4px' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="status-clock" style={{ opacity: 0.6 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </span>
    )
  }

  if (normalized === 'DELIVERED') {
    return (
      <span className="msg-status-tick" title="Delivered" style={{ display: 'inline-flex', alignSelf: 'center', marginLeft: '4px' }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="currentColor" className="status-delivered" style={{ opacity: 0.6 }}><path d="M11.053 1.053a.75.75 0 0 0-1.06 0L4.437 6.61 2.227 4.4a.75.75 0 1 0-1.06 1.06l2.742 2.742a.75.75 0 0 0 1.06 0l6.084-6.085a.75.75 0 0 0 0-1.064zm4.242 0a.75.75 0 0 0-1.06 0L8.15 7.138l-1.47-1.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l6.615-6.615a.75.75 0 0 0 0-1.06z"/></svg>
      </span>
    )
  }

  if (normalized === 'READ' || normalized === 'PLAYED') {
    return (
      <span className="msg-status-tick" title="Read" style={{ display: 'inline-flex', alignSelf: 'center', marginLeft: '4px' }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="#53bdeb" className="status-read"><path d="M11.053 1.053a.75.75 0 0 0-1.06 0L4.437 6.61 2.227 4.4a.75.75 0 1 0-1.06 1.06l2.742 2.742a.75.75 0 0 0 1.06 0l6.084-6.085a.75.75 0 0 0 0-1.064zm4.242 0a.75.75 0 0 0-1.06 0L8.15 7.138l-1.47-1.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l6.615-6.615a.75.75 0 0 0 0-1.06z"/></svg>
      </span>
    )
  }

  // default to SENT
  return (
    <span className="msg-status-tick" title="Sent" style={{ display: 'inline-flex', alignSelf: 'center', marginLeft: '4px' }}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="currentColor" className="status-sent" style={{ opacity: 0.6 }}><path d="M15.006 1.014a.75.75 0 0 0-1.062 0l-9.52 9.52-4.148-4.148a.75.75 0 0 0-1.06 1.06l4.678 4.678a.75.75 0 0 0 1.06 0l10.052-10.052a.75.75 0 0 0 0-1.058z"/></svg>
    </span>
  )
}

interface InfoModalProps {
  receipts: MessageReceiptInfo[]
  onClose: () => void
}

function MessageInfoModal({ receipts, onClose }: InfoModalProps) {
  const formatReceiptTime = (timestampStr: string) => {
    try {
      const ts = parseInt(timestampStr, 10)
      if (isNaN(ts)) return ''
      return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  const formatReceiptDate = (timestampStr: string) => {
    try {
      const ts = parseInt(timestampStr, 10)
      if (isNaN(ts)) return ''
      return new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return ''
    }
  }

  return (
    <div className="info-modal-backdrop" onClick={onClose}>
      <div className="info-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="info-modal-header">
          <h3>Message Info</h3>
          <button className="info-modal-close" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="info-modal-content">
          {receipts.length === 0 ? (
            <p className="no-receipts-label">No delivery information available yet.</p>
          ) : (
            <div className="receipts-list">
              {receipts.map((receipt) => (
                <div className="receipt-item" key={receipt.userJid}>
                  <div className="receipt-item-details">
                    <span className="receipt-item-name">{receipt.name}</span>
                    <span className="receipt-item-jid">{receipt.userJid.split('@')[0]}</span>
                  </div>
                  <div className="receipt-item-status">
                    {receipt.status === 'READ' ? (
                      <div className="status-badge read">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="#53bdeb" className="status-read"><path d="M11.053 1.053a.75.75 0 0 0-1.06 0L4.437 6.61 2.227 4.4a.75.75 0 1 0-1.06 1.06l2.742 2.742a.75.75 0 0 0 1.06 0l6.084-6.085a.75.75 0 0 0 0-1.064zm4.242 0a.75.75 0 0 0-1.06 0L8.15 7.138l-1.47-1.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l6.615-6.615a.75.75 0 0 0 0-1.06z"/></svg>
                        <span>Read • {formatReceiptTime(receipt.timestamp)} <span className="receipt-date">{formatReceiptDate(receipt.timestamp)}</span></span>
                      </div>
                    ) : (
                      <div className="status-badge delivered">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" width="16" height="11" fill="currentColor" className="status-delivered" style={{ opacity: 0.6 }}><path d="M11.053 1.053a.75.75 0 0 0-1.06 0L4.437 6.61 2.227 4.4a.75.75 0 1 0-1.06 1.06l2.742 2.742a.75.75 0 0 0 1.06 0l6.084-6.085a.75.75 0 0 0 0-1.064zm4.242 0a.75.75 0 0 0-1.06 0L8.15 7.138l-1.47-1.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l6.615-6.615a.75.75 0 0 0 0-1.06z"/></svg>
                        <span>Delivered • {formatReceiptTime(receipt.timestamp)} <span className="receipt-date">{formatReceiptDate(receipt.timestamp)}</span></span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
