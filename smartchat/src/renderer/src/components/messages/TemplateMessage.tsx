import { useState } from 'react'
import { api } from '../../services/api.service'
import { ImageMessage, VideoMessage, DocumentMessage } from './MediaMessages'
import { TextMessage } from './TextMessage'
import { formatTime } from '../../utils/formatters'
import { MessageStatusTick } from '../MessageItem'
import { HydratedButton, InteractiveButton, TemplateMessageProps } from '../../types'

interface ParsedButton {
  type: 'quick_reply' | 'url' | 'call'
  text: string
  payload?: string
}

export const TemplateMessage = ({
  msg,
  rawMsg,
  onDownload,
  isDownloading
}: TemplateMessageProps) => {
  const [isSendingReply, setIsSendingReply] = useState(false)

  const templateMsg = rawMsg?.templateMessage || {}
  const hydratedFourRowTemplate = templateMsg.hydratedFourRowTemplate || templateMsg.hydratedTemplate
  const interactiveMessageTemplate = templateMsg.interactiveMessageTemplate

  // 1. Extract Body Text & Footer
  const bodyText =
    hydratedFourRowTemplate?.hydratedContentText ||
    interactiveMessageTemplate?.body?.text ||
    msg.textContent ||
    ''

  const footerText =
    hydratedFourRowTemplate?.hydratedFooterText ||
    interactiveMessageTemplate?.footer?.text ||
    ''

  // 2. Extract Media Headers
  const imageMessage =
    hydratedFourRowTemplate?.imageMessage ||
    interactiveMessageTemplate?.header?.imageMessage

  const videoMessage =
    hydratedFourRowTemplate?.videoMessage ||
    interactiveMessageTemplate?.header?.videoMessage

  const documentMessage =
    hydratedFourRowTemplate?.documentMessage ||
    interactiveMessageTemplate?.header?.documentMessage

  const headerText =
    interactiveMessageTemplate?.header?.title ||
    interactiveMessageTemplate?.header?.text

  const localURI =
    imageMessage?.localURI ||
    videoMessage?.localURI ||
    documentMessage?.localURI ||
    msg.localURI

  // 3. Parse Header, Title, and Main Body section dynamically
  let smallHeader = headerText || ''
  let boldTitle = ''
  let mainBody = bodyText

  const trimmedBody = bodyText.trim()
  if (trimmedBody.includes('\n')) {
    const firstNewline = trimmedBody.indexOf('\n')
    const firstLine = trimmedBody.slice(0, firstNewline).trim()
    // Treat the first line as a bold title if it's not excessively long
    if (firstLine.length < 80) {
      boldTitle = firstLine.replace(/^\*|\*$/g, '') // strip markdown asterisks if present
      mainBody = trimmedBody.slice(firstNewline + 1).trim()
    }
  }

  // 4. Extract Buttons
  const parsedButtons: ParsedButton[] = []

  // Parse Hydrated Buttons
  const hydratedButtons = hydratedFourRowTemplate?.hydratedButtons
  if (Array.isArray(hydratedButtons)) {
    hydratedButtons.forEach((b: HydratedButton) => {
      if (b.quickReplyButton) {
        parsedButtons.push({
          type: 'quick_reply',
          text: b.quickReplyButton.displayText || '',
          payload: b.quickReplyButton.id
        })
      } else if (b.urlButton) {
        parsedButtons.push({
          type: 'url',
          text: b.urlButton.displayText || '',
          payload: b.urlButton.url
        })
      } else if (b.callButton) {
        parsedButtons.push({
          type: 'call',
          text: b.callButton.displayText || '',
          payload: b.callButton.phoneNumber
        })
      }
    })
  }

  // Parse Interactive Native Flow Buttons
  const interactiveButtons = interactiveMessageTemplate?.nativeFlowMessage?.buttons
  if (Array.isArray(interactiveButtons)) {
    interactiveButtons.forEach((b: InteractiveButton) => {
      let params: Record<string, any> = {}
      try {
        params = b.buttonParamsJson ? JSON.parse(b.buttonParamsJson) : {}
      } catch (e) {
        console.error('[TemplateMessage] Error parsing buttonParamsJson', e)
      }

      const displayText = params.display_text || params.displayText || b.name || ''

      if (b.name === 'quick_reply') {
        parsedButtons.push({
          type: 'quick_reply',
          text: displayText,
          payload: params.id || params.payload
        })
      } else if (b.name === 'cta_url' || b.name === 'url') {
        parsedButtons.push({
          type: 'url',
          text: displayText,
          payload: params.url
        })
      } else if (b.name === 'cta_call' || b.name === 'call') {
        parsedButtons.push({
          type: 'call',
          text: displayText,
          payload: params.phone_number || params.phoneNumber
        })
      } else {
        parsedButtons.push({
          type: 'quick_reply',
          text: displayText,
          payload: params.id || b.name
        })
      }
    })
  }

  // Button Click Handlers
  const handleButtonClick = async (button: ParsedButton) => {
    if (button.type === 'url' && button.payload) {
      window.open(button.payload, '_blank', 'noopener,noreferrer')
    } else if (button.type === 'call' && button.payload) {
      window.open(`tel:${button.payload}`)
    } else if (button.type === 'quick_reply') {
      if (isSendingReply) return
      setIsSendingReply(true)
      try {
        await api.sendMessage(msg.chatJid, button.text)
      } catch (err) {
        console.error('[TemplateMessage] Error sending quick reply:', err)
      } finally {
        setIsSendingReply(false)
      }
    }
  }



  return (
    <div className="template-msg-container">
      {/* 1. Header Media Block */}
      {imageMessage && (
        <ImageMessage
          localURI={localURI}
          textContent={null}
          rawMsg={{ imageMessage }}
          onDownload={onDownload}
          isDownloading={isDownloading}
        />
      )}
      {videoMessage && (
        <VideoMessage
          localURI={localURI}
          textContent={null}
          rawMsg={{ videoMessage }}
          onDownload={onDownload}
          isDownloading={isDownloading}
        />
      )}
      {documentMessage && (
        <DocumentMessage
          localURI={localURI}
          textContent={null}
          rawMsg={{ documentMessage }}
          onDownload={onDownload}
          isDownloading={isDownloading}
        />
      )}

      {/* 2. Main Text Body block */}
      <div className="template-msg-body">
        {smallHeader && (
          <div className="template-small-header">
            {smallHeader}
          </div>
        )}

        {boldTitle && (
          <div className="template-bold-title">
            {boldTitle}
          </div>
        )}

        {mainBody && (
          <div className="template-body-text">
            <TextMessage text={mainBody} />
          </div>
        )}

        {footerText && (
          <div className="template-msg-footer">
            {footerText}
          </div>
        )}

        {/* 3. Right-Aligned Timestamp */}
        <div className="template-body-bottom">
          <span className="message-time" style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
            {formatTime(msg.timestamp)}
            {msg.isEdited && <span className="message-edited-badge">(edited)</span>}
            {msg.fromMe && <MessageStatusTick status={msg.status} />}
          </span>
        </div>
      </div>

      {/* 4. Actionable Stacked Buttons */}
      {parsedButtons.length > 0 && (
        <div className="template-msg-buttons">
          {parsedButtons.map((btn, index) => (
            <button
              key={index}
              className="template-msg-button"
              onClick={() => handleButtonClick(btn)}
              disabled={isSendingReply && btn.type === 'quick_reply'}
            >
              {/* Left column: Action / link icon */}
              <div className="template-msg-btn-icon">
                {btn.type === 'url' && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" x2="21" y1="14" y2="3" />
                  </svg>
                )}
                {btn.type === 'call' && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                )}
                {btn.type === 'quick_reply' && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v1.5" />
                  </svg>
                )}
              </div>

              {/* Center column: Centered text */}
              <div className="template-msg-btn-text">
                {btn.text}
              </div>

              {/* Right column: Empty cell to balance grid centering */}
              <div />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
