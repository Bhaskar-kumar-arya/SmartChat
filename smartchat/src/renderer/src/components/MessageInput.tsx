import { useState, useRef } from 'react'

interface MessageInputProps {
  onSend: (text: string) => void
}

export default function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    setText('')
    try {
      await onSend(trimmed)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="message-input-container">
      <input
        ref={inputRef}
        type="text"
        className="message-input"
        placeholder="Type a message..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={sending}
        autoFocus
      />
      <button
        className="send-button"
        onClick={handleSend}
        disabled={!text.trim() || sending}
        title="Send message"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      </button>
    </div>
  )
}
