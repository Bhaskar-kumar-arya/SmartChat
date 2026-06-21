import React, {
  useState, useRef, useEffect, useCallback,
  KeyboardEvent, useImperativeHandle, forwardRef
} from 'react'
import { ChatItem, SelectedContext } from '../../types/chatTypes'
import { ModelInfo } from '../../types/aiTypes'
import { useAPI } from '../../context/APIContext'
import { useMentionSession } from '../../hooks/useMentionSession'

// ── Types & Component Props ───────────────────────────────────────────────────

interface AISmartInputProps {
  chatList: ChatItem[]
  onSend: (prompt: string, mentions: SelectedContext[]) => void
  disabled?: boolean
  onAbort?: () => void
  externalValue?: { prompt: string; mentions: SelectedContext[] } | null
  onCancel?: () => void
  aiOptions?: { model: string; useThinkMode: boolean }
  availableModels?: ModelInfo[]
  // Dependency Inversion: Accept custom search handler
  searchContacts?: (query: string) => Promise<ChatItem[]>
}

export interface AISmartInputRef {
  focus: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

// ── Component ─────────────────────────────────────────────────────────────────

const AISmartInput = forwardRef<AISmartInputRef, AISmartInputProps>(({
  chatList,
  onSend,
  disabled,
  onAbort,
  externalValue,
  onCancel,
  aiOptions,
  availableModels,
  searchContacts
}, ref) => {
  const api = useAPI()
  const activeSearchContacts = searchContacts || api.searchMentionContacts

  // ── State ──────────────────────────────────────────────────────────────────
  const [inputValue, setInputValue] = useState('')
  const [mentions, setMentions]     = useState<SelectedContext[]>([])

  // ── Refs ───────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)

  // ── Mention Hook Integration (SRP/SOLID) ──────────────────────────────────
  const {
    mentionAnchor,
    setMentionAnchor,
    menuItems,
    selectedIndex,
    setSelectedIndex,
    searching,
    onInputChange,
    selectItem,
    removeChip,
    handleBackspace
  } = useMentionSession({
    chatList,
    searchContacts: activeSearchContacts,
    inputValue,
    setInputValue,
    mentions,
    setMentions,
    inputRef,
    autoGrow
  })

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))

  // ── Click outside → close menu ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMentionAnchor(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setMentionAnchor])

  // ── External value injection (edit-message mode) ──────────────────────────
  useEffect(() => {
    if (!externalValue) return
    setInputValue(externalValue.prompt)
    setMentions(externalValue.mentions)
    setMentionAnchor(null)
    setTimeout(() => {
      if (!inputRef.current) return
      inputRef.current.focus()
      const len = inputRef.current.value.length
      inputRef.current.setSelectionRange(len, len)
      autoGrow(inputRef.current)
    }, 0)
  }, [externalValue, setInputValue, setMentions, setMentionAnchor])

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    const menuOpen = mentionAnchor !== null && menuItems.length > 0

    // 1. Mention menu keyboard navigation
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % menuItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + menuItems.length) % menuItems.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (menuItems[selectedIndex]) selectItem(menuItems[selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setMentionAnchor(null)
        return
      }
    }

    // 2. Backspace trigger inside mentions hook
    if (e.key === 'Backspace') {
      const handled = handleBackspace(e)
      if (handled) return
    }

    // 3. Escape on closed menu cancels edit mode
    if (e.key === 'Escape' && !menuOpen) {
      onCancel?.()
      return
    }

    // 4. Enter to submit message
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const prompt = inputValue.trim()
      if (prompt && !disabled) {
        onSend(prompt, mentions)
        setInputValue('')
        setMentions([])
        setMentionAnchor(null)
        if (inputRef.current) inputRef.current.style.height = 'auto'
      }
    }
  }, [
    mentionAnchor,
    menuItems,
    selectedIndex,
    inputValue,
    mentions,
    disabled,
    onSend,
    onCancel,
    setMentionAnchor,
    setSelectedIndex,
    selectItem,
    handleBackspace,
    setInputValue,
    setMentions
  ])

  // ── Scroll sync ───────────────────────────────────────────────────────────
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop  = e.currentTarget.scrollTop
      highlightRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  // ── Highlight renderer ────────────────────────────────────────────────────
  const renderHighlight = () => {
    if (!inputValue) return null
    if (mentions.length === 0) return <span>{inputValue}</span>

    const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length)
    const pattern = sorted.map(m => escapeRegExp(`@${m.name}`)).join('|')
    const regex   = new RegExp(`(${pattern})`, 'g')
    const parts   = inputValue.split(regex)

    return (
      <>
        {parts.map((part, i) => {
          const hit = mentions.find(m => `@${m.name}` === part)
          return hit
            ? <span key={i} className="ai-input-match">{part}</span>
            : <span key={i}>{part}</span>
        })}
      </>
    )
  }

  // ── Model name formatter ──────────────────────────────────────────────────
  const getFriendlyModelName = (id: string) => {
    const c = id.replace(/^(gemini|lmstudio|groq|mistral|deepseek):/, '')
    if (c === 'gemma-4-31b-it') return 'Gemma 4 31B'
    if (c === 'mistral-large-latest') return 'Mistral Large'
    if (c === 'gpt-oss-120b' || c === 'openai/gpt-oss-120b') return 'Llama 3.3 120B'
    if (c === 'deepseek-v4-pro') return 'DeepSeek V4'
    if (c === 'deepseek-reasoner') return 'DeepSeek R1'
    return c
  }

  const activeModel     = availableModels?.find(m => m.id === aiOptions?.model)
  const activeModelName = activeModel
    ? activeModel.name
    : getFriendlyModelName(aiOptions?.model || 'Gemma 4 31B')

  const showMenu = mentionAnchor !== null && menuItems.length > 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="ai-input-wrapper">

      {/* ── Chips row ── */}
      {mentions.length > 0 && (
        <div className="ai-context-list">
          {mentions.map(m => (
            <div key={m.jid} className="ai-context-chip mention">
              <span>@{m.name}</span>
              <button onClick={() => removeChip(m)} title="Remove mention">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6"  y2="18"/>
                  <line x1="6"  y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Mention dropdown ── */}
      {showMenu && (
        <div className="ai-mention-menu">
          {searching && (
            <div className="ai-mention-searching">
              <span/><span/><span/>
            </div>
          )}
          {menuItems.map((chat, idx) => {
            const displayName = chat.name || chat.jid.split('@')[0] || '??'
            const extraName   = chat.pushName || chat.verifiedName
            const hasExtra    = !!extraName &&
              extraName.trim().toLowerCase() !== displayName.trim().toLowerCase()

            const parts: string[] = []
            if (chat.phoneNumber) {
              const n = chat.phoneNumber.split('@')[0]
              parts.push(/^\d+$/.test(n) ? `+${n}` : n)
            } else if (!chat.jid.includes('@g.us') && !chat.jid.includes('@newsletter')) {
              const n = chat.jid.split('@')[0]
              if (/^\d+$/.test(n)) parts.push(`+${n}`)
            }
            if (chat.jid.includes('@g.us'))         parts.push('Group')
            else if (chat.jid.includes('@newsletter')) parts.push('Channel')

            return (
              <div
                key={chat.jid}
                className={`ai-mention-item${idx === selectedIndex ? ' active' : ''}`}
                // onMouseDown prevents textarea blur before click finishes
                onMouseDown={e => { e.preventDefault(); selectItem({ ...chat, name: displayName }) }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                {chat.profilePictureUrl
                  ? <img src={chat.profilePictureUrl} alt="" className="ai-mention-pic"/>
                  : <div className="ai-mention-pic-placeholder">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                }
                <div className="ai-mention-info">
                  <span className="ai-mention-name">
                    {displayName}
                    {hasExtra && (
                      <span className="ai-mention-pushname"> ~{extraName!.trim()}</span>
                    )}
                  </span>
                  {parts.length > 0 && (
                    <span className="ai-mention-subtext">{parts.join(' • ')}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Input box ── */}
      <div className="ai-input-box">
        <div className="ai-input-content">
          <div className="ai-input-inner">

            {/* Highlight layer */}
            <div
              ref={highlightRef}
              className="ai-input-highlight"
              aria-hidden="true"
            >
              {renderHighlight()}
              {/* Phantom trailing newline keeps height identical to textarea */}
              {'\n'}
            </div>

            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={onInputChange}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              disabled={disabled}
              className="ai-input-field"
              placeholder="Ask AI… (@ to mention)"
              rows={1}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* Status bar */}
          {aiOptions && (
            <div className="ai-status-bar">
              <span className="ai-model-label">{activeModelName}</span>
              {aiOptions.useThinkMode && (
                <span className="ai-think-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .5 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
                    <path d="M9 18h6"/><path d="M10 22h4"/>
                  </svg>
                  <span>Thinking</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Send / Abort button */}
        {disabled && onAbort ? (
          <button className="ai-send-btn abort" onClick={onAbort} title="Stop Generation">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12"/>
            </svg>
          </button>
        ) : (
          <button
            className="ai-send-btn"
            onClick={() => {
              const prompt = inputValue.trim()
              if (prompt && !disabled) {
                onSend(prompt, mentions)
                setInputValue('')
                setMentions([])
                setMentionAnchor(null)
                if (inputRef.current) inputRef.current.style.height = 'auto'
              }
            }}
            disabled={disabled || !inputValue.trim()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
})

export default AISmartInput
