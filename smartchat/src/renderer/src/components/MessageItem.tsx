import { useState } from 'react'
import { MessageItem as IMessageItem, ReactionItem } from '../types'
import { formatTime } from '../utils/formatters'
import { TextMessage } from './messages/TextMessage'
import { ImageMessage, StickerMessage, VideoMessage, DocumentMessage, AudioMessage } from './messages/MediaMessages'

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
  onDownloadMedia?: (msgId: string) => Promise<void>
  onViewReactions: (msg: IMessageItem) => void
}

export default function MessageItem({ msg, onReply, onDownloadMedia, onViewReactions }: MessageItemProps) {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    if (onDownloadMedia) {
      setDownloading(true)
      try { await onDownloadMedia(msg.id) }
      finally { setDownloading(false) }
    }
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

  const renderContent = () => {
    if (isImage) return <ImageMessage localURI={localURI} textContent={msg.textContent} onDownload={handleDownload} isDownloading={downloading} />
    if (isSticker) return <StickerMessage localURI={localURI} onDownload={handleDownload} isDownloading={downloading} />
    if (isVideo) return <VideoMessage localURI={localURI} textContent={msg.textContent} rawMsg={rawMsg} onDownload={handleDownload} isDownloading={downloading} />
    if (isDocument) return <DocumentMessage localURI={localURI} textContent={msg.textContent} rawMsg={rawMsg} onDownload={handleDownload} isDownloading={downloading} />
    if (isAudio) return <AudioMessage localURI={localURI} senderJid={msg.participant || msg.remoteJid} onDownload={handleDownload} isDownloading={downloading} rawMsg={rawMsg} />
    if (msg.textContent) return <TextMessage text={msg.textContent} mentions={ctx?.mentions} />
    return <p className="message-text message-unsupported">[{msg.messageType}]</p>
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

        {msg.textContent && isImage && <TextMessage text={msg.textContent} mentions={ctx?.mentions} />}
        {msg.textContent && isVideo && <TextMessage text={msg.textContent} mentions={ctx?.mentions} />}
        {msg.textContent && isDocument && <TextMessage text={msg.textContent} mentions={ctx?.mentions} />}

        <ReactionsDisplay reactions={msg.reactions} onClick={() => onViewReactions(msg)} />
        <span className="message-time">{formatTime(msg.timestamp)}</span>
      </div>
      <div className="message-actions">
         <button className="action-btn" onClick={() => onReply(msg)} title="Reply">
           <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v1.5"/></svg>
         </button>
      </div>
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
