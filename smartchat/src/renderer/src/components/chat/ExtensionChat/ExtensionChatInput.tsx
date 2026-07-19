import { useState, useRef, useEffect, useCallback } from 'react'
import { SlashCommand } from '../../../types/extension.types'

interface ExtensionChatInputProps {
  commands: SlashCommand[]
  onSend: (text: string) => void // does NOT know about extensionId — caller provides send fn
}

/**
 * ISP: Only receives commands[] + onSend — not the full manifest.
 * DIP satisfied: calls onSend, never api.* directly.
 */
export function ExtensionChatInput({ commands, onSend }: ExtensionChatInputProps) {
  const [text, setText] = useState('')
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [filteredCmds, setFilteredCmds] = useState<SlashCommand[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (text.startsWith('/')) {
      const query = text.slice(1).toLowerCase()
      const matches = commands.filter(
        (c) => c.command.toLowerCase().startsWith(query)
      )
      setFilteredCmds(matches)
      setShowAutocomplete(matches.length > 0)
    } else {
      setShowAutocomplete(false)
    }
  }, [text, commands])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') setShowAutocomplete(false)
  }

  const submit = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
    setShowAutocomplete(false)
  }, [text, onSend])

  const selectCommand = (cmd: SlashCommand) => {
    setText(`/${cmd.command} `)
    setShowAutocomplete(false)
    inputRef.current?.focus()
  }

  return (
    <div className="ext-chat-input-wrapper">
      {showAutocomplete && (
        <div className="ext-slash-autocomplete">
          {filteredCmds.map((cmd) => (
            <div
              key={cmd.command}
              className="ext-slash-item"
              onClick={() => selectCommand(cmd)}
            >
              <span className="ext-slash-command">/{cmd.command}</span>
              <span className="ext-slash-desc">{cmd.description}</span>
            </div>
          ))}
        </div>
      )}
      <div className="ext-chat-input-row">
        <input
          ref={inputRef}
          type="text"
          className="ext-chat-input"
          placeholder="Type a message or /command…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button
          className="ext-send-btn"
          onClick={submit}
          disabled={!text.trim()}
          title="Send"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
