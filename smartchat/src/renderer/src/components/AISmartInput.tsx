import React, { useState, useRef, useEffect, KeyboardEvent, useImperativeHandle, forwardRef } from 'react'
import { ChatItem } from '../types'

interface SelectedContext {
  jid: string
  name: string
}

interface AISmartInputProps {
  chatList: ChatItem[]
  onSend: (prompt: string, contexts: SelectedContext[], mentions: SelectedContext[]) => void
  disabled?: boolean
  onAbort?: () => void
  externalValue?: { prompt: string, contexts: SelectedContext[], mentions: SelectedContext[] } | null
  onCancel?: () => void
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
  onCancel
}, ref) => {
  const [inputValue, setInputValue] = useState('')
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [menuType, setMenuType] = useState<'context' | 'mention'>('context')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filteredChats, setFilteredChats] = useState<ChatItem[]>([])
  
  const [contexts, setContexts] = useState<SelectedContext[]>([])
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
      setContexts(externalValue.contexts);
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
    setContexts(prev => prev.filter(c => inputValue.includes(`/${c.name}`)));
  }, [inputValue]);

  useEffect(() => {
    if (mentionQuery) {
      setFilteredChats(
        chatList.filter(c => {
          const dn = c.name || c.jid.split('@')[0] || '';
          return dn.toLowerCase().includes(mentionQuery.toLowerCase());
        })
      )
    } else {
      setFilteredChats(chatList.slice(0, 10))
    }
    setSelectedIndex(0)
  }, [mentionQuery, chatList])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputValue(val)
    
    // Auto-grow height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }

    const lastSlashPos = val.lastIndexOf('/')
    if (lastSlashPos !== -1) {
      const textAfterSlash = val.slice(lastSlashPos + 1)
      if (!textAfterSlash.includes(' ')) {
        setShowMentionMenu(true)
        setMenuType('context')
        setMentionQuery(textAfterSlash)
        return
      }
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
        let matchType = '';
        let isSpace = false;
        
        for (const m of mentions) {
          if (textBefore.endsWith(`@${m.name} `)) { matchToDelete = m; matchType = 'mention'; isSpace = true; break; }
          if (textBefore.endsWith(`@${m.name}`)) { matchToDelete = m; matchType = 'mention'; break; }
        }
        
        if (!matchToDelete) {
          for (const c of contexts) {
            if (textBefore.endsWith(`/${c.name} `)) { matchToDelete = c; matchType = 'context'; isSpace = true; break; }
            if (textBefore.endsWith(`/${c.name}`)) { matchToDelete = c; matchType = 'context'; break; }
          }
        }

        if (matchToDelete) {
          e.preventDefault();
          const prefix = matchType === 'mention' ? '@' : '/';
          const lenToDel = prefix.length + matchToDelete.name.length + (isSpace ? 1 : 0);
          const newText = inputValue.slice(0, cursorStart - lenToDel) + inputValue.slice(cursorStart);
          setInputValue(newText);
          
          if (matchType === 'mention') {
            setMentions(mentions.filter(m => m.jid !== matchToDelete!.jid));
          } else {
            setContexts(contexts.filter(c => c.jid !== matchToDelete!.jid));
          }
          
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
        if (prompt || contexts.length > 0) {
          onSend(prompt, contexts, mentions)
          setInputValue('')
          setContexts([])
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
    if (menuType === 'context') {
      if (!contexts.find(c => c.jid === chat.jid)) {
        setContexts([...contexts, { jid: chat.jid, name: displayName }])
      }
      const lastSlashPos = inputValue.lastIndexOf('/')
      if (lastSlashPos !== -1) {
        setInputValue(inputValue.slice(0, lastSlashPos) + `/${displayName} `)
      }
    } else {
      if (!mentions.find(m => m.jid === chat.jid)) {
        setMentions([...mentions, { jid: chat.jid, name: displayName }])
      }
      const lastAtPos = inputValue.lastIndexOf('@')
      if (lastAtPos !== -1) {
        setInputValue(inputValue.slice(0, lastAtPos) + `@${displayName} `)
      }
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

  return (
    <div ref={containerRef} className="ai-input-wrapper">
      <div className="ai-context-list-container">
        {contexts.length > 0 && (
          <div className="ai-context-list">
            {contexts.map(c => (
              <div key={c.jid} className="ai-context-chip history">
                <span>/{c.name}</span>
                <button onClick={() => setContexts(contexts.filter(x => x.jid !== c.jid))}>x</button>
              </div>
            ))}
          </div>
        )}
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
                  <span className="ai-mention-name">{displayName}</span>
                  <span className="ai-mention-jid">@{chat.jid.split('@')[0]}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="ai-input-box">
        <div className="ai-input-inner">
          <div 
            ref={highlightRef}
            className="ai-input-highlight"
          >
            {renderHighlightedText()}
          </div>
          <textarea 
            ref={inputRef}
            placeholder="Ask AI... (/ history, @ mention)" 
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onScroll={handleInputScroll}
            disabled={disabled}
            className="ai-input-field"
            rows={1}
          />
        </div>
        {disabled && onAbort ? (
          <button 
            className="ai-send-btn abort" 
            onClick={onAbort} 
            title="Stop Generation"
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
              if (prompt || contexts.length > 0) {
                onSend(prompt, contexts, mentions)
                setInputValue('')
                setContexts([])
                setMentions([])
              }
            }} 
            disabled={disabled || (!inputValue.trim() && contexts.length === 0)}
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
