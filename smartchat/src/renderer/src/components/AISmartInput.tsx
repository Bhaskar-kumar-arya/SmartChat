import React, { useState, useRef, useEffect, KeyboardEvent, useImperativeHandle, forwardRef } from 'react'
import { ChatItem, ModelInfo } from '../types'

interface SelectedContext {
  jid: string
  name: string
}

interface AISmartInputProps {
  chatList: ChatItem[]
  onSend: (prompt: string, mentions: SelectedContext[]) => void
  disabled?: boolean
  onAbort?: () => void
  externalValue?: { prompt: string, mentions: SelectedContext[] } | null
  onCancel?: () => void
  aiOptions?: { model: string; useThinkMode: boolean }
  availableModels?: ModelInfo[]
}

export interface AISmartInputRef {
  focus: () => void;
}

const AISmartInput = forwardRef<AISmartInputRef, AISmartInputProps>(({ 
  chatList, 
  onSend, 
  disabled, 
  onAbort, 
  externalValue, 
  onCancel,
  aiOptions,
  availableModels
}, ref) => {
  const [inputValue, setInputValue] = useState('')
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [menuType, setMenuType] = useState<'context' | 'mention'>('mention')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filteredChats, setFilteredChats] = useState<ChatItem[]>([])
  
  const contexts: SelectedContext[] = []
  const [mentions, setMentions] = useState<SelectedContext[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus()
    }
  }))

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowMentionMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (externalValue) {
      setInputValue(externalValue.prompt);
      setMentions(externalValue.mentions);
      
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Move cursor to end
          const length = inputRef.current.value.length;
          inputRef.current.setSelectionRange(length, length);
          
          // Recalculate height
          inputRef.current.style.height = 'auto';
          inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
        }
      }, 0);
    }
  }, [externalValue]);

  useEffect(() => {
    setMentions(prev => prev.filter(m => inputValue.includes(`@${m.name}`)));
  }, [inputValue]);

  useEffect(() => {
    let active = true
    if (mentionQuery) {
      if (menuType === 'mention') {
        window.api.searchMentionContacts(mentionQuery)
          .then(results => {
            if (active) setFilteredChats(results as any[])
          })
          .catch(err => {
            console.error('Failed to search mention contacts:', err)
          })
      } else {
        window.api.searchMentionChats(mentionQuery)
          .then(results => {
            if (active) setFilteredChats(results as any[])
          })
          .catch(err => {
            console.error('Failed to search mention chats:', err)
          })
      }
    } else {
      setFilteredChats(chatList.slice(0, 10))
    }
    setSelectedIndex(0)
    return () => {
      active = false
    }
  }, [mentionQuery, menuType, chatList])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputValue(val)
    
    // Auto-grow height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }

    const lastAtPos = val.lastIndexOf('@')
    if (lastAtPos !== -1) {
      const textAfterAt = val.slice(lastAtPos + 1)
      if (!textAfterAt.includes(' ')) {
        setShowMentionMenu(true)
        setMenuType('mention')
        setMentionQuery(textAfterAt)
        return
      }
    }

    setShowMentionMenu(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % filteredChats.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + filteredChats.length) % filteredChats.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredChats[selectedIndex]) {
          selectItem(filteredChats[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setShowMentionMenu(false)
      }
      return
    }

    if (e.key === 'Backspace' && inputRef.current) {
      const cursorStart = inputRef.current.selectionStart || 0;
      const cursorEnd = inputRef.current.selectionEnd || 0;
      
      if (cursorStart === cursorEnd) {
        const textBefore = inputValue.slice(0, cursorStart);
        let matchToDelete: SelectedContext | null = null;
        let isSpace = false;
        
        for (const m of mentions) {
          if (textBefore.endsWith(`@${m.name} `)) { matchToDelete = m; isSpace = true; break; }
          if (textBefore.endsWith(`@${m.name}`)) { matchToDelete = m; break; }
        }

        if (matchToDelete) {
          e.preventDefault();
          const prefix = '@';
          const lenToDel = prefix.length + matchToDelete.name.length + (isSpace ? 1 : 0);
          const newText = inputValue.slice(0, cursorStart - lenToDel) + inputValue.slice(cursorStart);
          setInputValue(newText);
          
          setMentions(mentions.filter(m => m.jid !== matchToDelete!.jid));
          
          setTimeout(() => {
            if (inputRef.current) {
              const newPos = cursorStart - lenToDel;
              inputRef.current.setSelectionRange(newPos, newPos);
            }
          }, 0);
          return;
        }
      }
    }

    if (e.key === 'Escape') {
      onCancel?.();
      return;
    }

    if (e.key === 'Enter') {
      if (!e.shiftKey) {
        e.preventDefault(); // Prevent newline
        const prompt = inputValue.trim()
        if (prompt) {
          onSend(prompt, mentions)
          setInputValue('')
          setMentions([])
          if (inputRef.current) inputRef.current.style.height = 'auto';
        }
      } else {
        // Shift+Enter: Allow default behavior (newline)
      }
    }
  }

  const selectItem = (chat: ChatItem) => {
    const displayName = (chat.name || chat.jid.split('@')[0] || '??').trim();
    if (!mentions.find(m => m.jid === chat.jid)) {
      setMentions([...mentions, { jid: chat.jid, name: displayName }])
    }
    const lastAtPos = inputValue.lastIndexOf('@')
    if (lastAtPos !== -1) {
      setInputValue(inputValue.slice(0, lastAtPos) + `@${displayName} `)
    }
    setShowMentionMenu(false)
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const length = inputRef.current.value.length;
        inputRef.current.setSelectionRange(length, length);
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
      }
    }, 0);
  }

  const handleInputScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = e.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const renderHighlightedText = () => {
    if (!inputValue) return null;
    const activeItems = [
      ...contexts.map(c => ({ text: `/${c.name}`, type: 'history' })),
      ...mentions.map(m => ({ text: `@${m.name}`, type: 'mention' }))
    ].sort((a, b) => b.text.length - a.text.length);

    if (activeItems.length === 0) return <span>{inputValue}</span>;

    const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${activeItems.map(item => escapeRegExp(item.text)).join('|')})`, 'g');
    const parts = inputValue.split(regex);
    
    return parts.map((part, i) => {
      const matchedItem = activeItems.find(item => item.text === part);
      if (matchedItem) {
        return (
          <span key={i} className="ai-input-match">
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const getFriendlyModelName = (id: string) => {
    const cleanId = id.replace(/^(gemini|lmstudio|groq|mistral|deepseek):/, '');
    if (cleanId === 'gemma-4-31b-it') return 'Gemma 4 31B';
    if (cleanId === 'mistral-large-latest') return 'Mistral Large';
    if (cleanId === 'gpt-oss-120b' || cleanId === 'openai/gpt-oss-120b') return 'Llama 3.3 120B';
    if (cleanId === 'deepseek-v4-pro') return 'DeepSeek V4';
    if (cleanId === 'deepseek-reasoner') return 'DeepSeek R1';
    return cleanId;
  };
  const activeModel = availableModels?.find(m => m.id === aiOptions?.model);
  const activeModelName = activeModel ? activeModel.name : getFriendlyModelName(aiOptions?.model || 'Gemma 4 31B');

  return (
    <div ref={containerRef} className="ai-input-wrapper">
      <div className="ai-context-list-container">
        {mentions.length > 0 && (
          <div className="ai-context-list">
            {mentions.map(m => (
              <div key={m.jid} className="ai-context-chip mention">
                <span>@{m.name}</span>
                <button onClick={() => setMentions(mentions.filter(x => x.jid !== m.jid))}>x</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showMentionMenu && filteredChats.length > 0 && (
        <div className="ai-mention-menu">
          {filteredChats.map((chat, idx) => {
            const displayName = chat.name || chat.jid.split('@')[0] || '??';
            const extraName = chat.pushName || chat.verifiedName;
            
            const secondaryParts: string[] = [];
            
            // 1. Phone number
            if (chat.phoneNumber) {
              const num = chat.phoneNumber.split('@')[0];
              if (/^\d+$/.test(num)) {
                secondaryParts.push(`+${num}`);
              } else {
                secondaryParts.push(num);
              }
            } else if (!chat.jid.includes('@g.us') && !chat.jid.includes('@newsletter')) {
              const num = chat.jid.split('@')[0];
              if (/^\d+$/.test(num)) {
                secondaryParts.push(`+${num}`);
              }
            }

            // 2. Chat type / JID identifier
            if (chat.jid.includes('@g.us')) {
              secondaryParts.push('Group');
            } else if (chat.jid.includes('@newsletter')) {
              secondaryParts.push('Channel');
            } else {
              const username = chat.jid.split('@')[0];
              if (!chat.phoneNumber && !/^\d+$/.test(username)) {
                secondaryParts.push(`@${username}`);
              }
            }

            // 3. LID identifier
            if (chat.jid.endsWith('@lid')) {
              secondaryParts.push(`LID: ${chat.jid.split('@')[0]}`);
            }

            const secondaryText = secondaryParts.join(' • ');

            const hasExtraName = extraName && extraName.trim() !== '' && extraName.trim().toLowerCase() !== displayName.trim().toLowerCase();

            return (
              <div 
                key={chat.jid} 
                className={`ai-mention-item ${idx === selectedIndex ? 'active' : ''}`} 
                onClick={() => selectItem({ ...chat, name: displayName })}
              >
                {chat.profilePictureUrl ? (
                  <img src={chat.profilePictureUrl} alt="" className="ai-mention-pic" />
                ) : (
                  <div className="ai-mention-pic-placeholder">{displayName.charAt(0).toUpperCase()}</div>
                )}
                <div className="ai-mention-info">
                  <span className="ai-mention-name">
                    {displayName}
                    {hasExtraName && (
                      <span className="ai-mention-pushname"> ~{extraName!.trim()}</span>
                    )}
                  </span>
                  {secondaryText && (
                    <span className="ai-mention-subtext">{secondaryText}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="ai-input-box" style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '6px', minWidth: 0 }}>
          <div className="ai-input-inner">
            <div 
              ref={highlightRef}
              className="ai-input-highlight"
            >
              {renderHighlightedText()}
            </div>
            <textarea 
              ref={inputRef}
              placeholder="Ask AI... (@ mention)" 
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onScroll={handleInputScroll}
              disabled={disabled}
              className="ai-input-field"
              rows={1}
            />
          </div>
          
          {/* Bottom status row */}
          {aiOptions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '6px 4px 0 4px', fontSize: '11px', color: 'var(--wa-text-secondary, #8696a0)', userSelect: 'none', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ cursor: 'default', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 500, color: 'var(--wa-text-primary, #fff)' }}>
                {activeModelName}
              </span>
              {aiOptions.useThinkMode && (
                <span style={{ cursor: 'default', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--wa-primary, #00a884)', fontWeight: 600 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .5 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
                    <path d="M9 18h6" />
                    <path d="M10 22h4" />
                  </svg>
                  <span>Thinking</span>
                </span>
              )}
            </div>
          )}
        </div>

        {disabled && onAbort ? (
          <button 
            className="ai-send-btn abort" 
            onClick={onAbort} 
            title="Stop Generation"
            style={{ alignSelf: 'flex-end', marginBottom: '2px' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12"></rect>
            </svg>
          </button>
        ) : (
          <button 
            className="ai-send-btn" 
            onClick={() => {
              const prompt = inputValue.trim()
              if (prompt) {
                onSend(prompt, mentions)
                setInputValue('')
                setMentions([])
              }
            }} 
            disabled={disabled || !inputValue.trim()}
            style={{ alignSelf: 'flex-end', marginBottom: '2px' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
})

export default AISmartInput
