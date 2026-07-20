import { useRef, useEffect } from 'react'
import { useExtensionChat } from '../../../hooks/useExtensionChat'
import { useAPI } from '../../../context/APIContext'
import { SlashCommand } from '../../../types/extension.types'
import { ExtensionMessageRenderer } from './ExtensionMessageRenderer'
import { ExtensionChatInput } from './ExtensionChatInput'
import '../../../styles/extension-chat.css'

interface ExtensionChatViewProps {
  extensionId: string
  commands: SlashCommand[] // ISP: only the slice of manifest this component needs
}

/**
 * ISP: receives extensionId + commands[] only — not the full manifest.
 * DIP: uses useExtensionChat hook — no direct api calls.
 */
export function ExtensionChatView({ extensionId, commands }: ExtensionChatViewProps) {
  const api = useAPI()
  const { messages, send } = useExtensionChat(extensionId)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleAction = (buttonId: string) => {
    // Button press — route as a special message prefixed with button id
    api.extensionChatSend(extensionId, `__button:${buttonId}`)
  }

  return (
    <div className="ext-chat-view">
      <div className="ext-chat-messages">
        {messages.length === 0 && (
          <div className="ext-chat-empty">
            <span className="ext-chat-empty-icon">🤖</span>
            <p>Send a message to start the conversation</p>
            {commands.length > 0 && (
              <p className="ext-chat-empty-hint">
                Try /{commands[0].name} — {commands[0].description}
              </p>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`ext-message ${msg.role === 'user' ? 'ext-message--user' : 'ext-message--extension'}`}
          >
            <div className="ext-message-bubble">
              <ExtensionMessageRenderer message={msg} onAction={handleAction} />
            </div>
            <div className="ext-message-time">
              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <ExtensionChatInput commands={commands} onSend={send} />
    </div>
  )
}
