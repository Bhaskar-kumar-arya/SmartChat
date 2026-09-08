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
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (text.startsWith('/')) {
      const query = text.slice(1).toLowerCase()
      const matches = commands.filter(
        (c) => c.name.toLowerCase().startsWith(query)
      )
      setFilteredCmds(matches)
      setShowAutocomplete(matches.length > 0)
      setHighlightIdx(0)
    } else {
      setShowAutocomplete(false)
    }
  }, [text, commands])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showAutocomplete && filteredCmds.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIdx((i) => (i + 1) % filteredCmds.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIdx((i) => (i - 1 + filteredCmds.length) % filteredCmds.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        selectCommand(filteredCmds[highlightIdx])
        return
      }
      if (e.key === 'Escape') {
        // Consume it so an ancestor close-on-Escape handler doesn't also fire.
        e.preventDefault()
        e.stopPropagation()
        setShowAutocomplete(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const submit = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
    setShowAutocomplete(false)
  }, [text, onSend])

  const selectCommand = (cmd: SlashCommand) => {
    setText(`/${cmd.name} `)
    setShowAutocomplete(false)
    inputRef.current?.focus()
  }

  return (
    <div className="ext-chat-input-wrapper">
      {showAutocomplete && (
        <div className="ext-slash-autocomplete">
          {filteredCmds.map((cmd, i) => (
            <div
              key={cmd.name}
              className={`ext-slash-item ${i === highlightIdx ? 'ext-slash-item--active' : ''}`}
              onMouseEnter={() => setHighlightIdx(i)}
              onClick={() => selectCommand(cmd)}
            >
              <span className="ext-slash-command">/{cmd.name}</span>
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
