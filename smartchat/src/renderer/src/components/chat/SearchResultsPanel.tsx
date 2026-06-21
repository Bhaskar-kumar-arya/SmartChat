import { SearchResultItem, SearchMode } from '../../types/chatTypes'
import { formatChatTime } from '../../utils/formatters'

interface SearchResultsPanelProps {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
  isSearching: boolean
  query: string
  activeJid: string | null
  mode: SearchMode
  onSelectChat: (jid: string, name: string, messageId?: string | null) => void
}

/**
 * Displays global search results grouped by Chats and Messages.
 * Single Responsibility: this component ONLY renders search results.
 * Open/Closed: new result types can be added without modifying this component's callers.
 */
export function SearchResultsPanel({
  chats,
  messages,
  isSearching,
  query,
  activeJid,
  mode,
  onSelectChat
}: SearchResultsPanelProps) {
  const hasResults = chats.length > 0 || messages.length > 0

  if (isSearching) {
    return (
      <div className="search-results-panel">
        <div className="search-results-loading">
          <div className="loading-animation">
            <div className="circle pulse" />
            <div className="circle pulse delay-1" />
          </div>
          <span className="loading-text">
            {mode === 'deep' ? 'Searching deeper meanings...' : 'Searching...'}
          </span>
          <p className="loading-sub">
            {mode === 'deep' 
               ? 'This may take a few seconds for large histories' 
               : 'Finding matches in your messages'}
          </p>
          {mode === 'deep' && (
            <div className="search-tip">
              <span className="tip-label">TIP:</span> Use filters to speed up search
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!hasResults && query.trim()) {
    return (
      <div className="search-results-panel">
        <div className="search-results-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <p>No results for "<strong>{query}</strong>"</p>
        </div>
      </div>
    )
  }

  const highlightMatch = (text: string, q: string) => {
    if (!q.trim()) return <span>{text}</span>
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return <span>{text}</span>
    return (
      <span>
        {text.slice(0, idx)}
        <mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </span>
    )
  }

  const renderScore = (score?: number) => {
    if (mode !== 'deep' || score === undefined) return null
    const pct = Math.round(score * 100)
    let color = '#a0a0a0'
    if (pct > 80) color = '#25D366'
    else if (pct > 60) color = '#34B7F1'
    
    return (
      <div className="result-score" style={{ color }}>
        <span className="score-sparkle">✦</span>
        {pct}% match
      </div>
    )
  }

  return (
    <div className="search-results-panel">
      {chats.length > 0 && (
        <div className="search-results-section">
          <div className="search-results-section-header">Chats</div>
          {chats.map((item) => (
            <div
              key={`chat-${item.jid}`}
              className={`search-result-item ${activeJid === item.jid ? 'active' : ''}`}
              onClick={() => onSelectChat(item.jid, item.name, null)}
            >
              <div className="search-result-avatar">
                {item.name.charAt(0).toUpperCase()}
              </div>
              <div className="search-result-content">
                <div className="search-result-name">{highlightMatch(item.name, query)}</div>
                {item.lastMessage && (
                  <div className="search-result-sub">{item.lastMessage}</div>
                )}
              </div>
              {item.timestamp && (
                <div className="search-result-time">
                  {formatChatTime(item.timestamp)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="search-results-section">
          <div className="search-results-section-header">Messages</div>
          {messages.map((item) => (
            <div
              key={`msg-${item.messageId}`}
              className={`search-result-item ${activeJid === item.jid ? 'active' : ''}`}
              onClick={() => onSelectChat(item.jid, item.name, item.messageId)}
            >
              <div className="search-result-avatar msg-avatar">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="search-result-content">
                <div className="search-result-top-row">
                  <span className="search-result-name">{item.name}</span>
                  {renderScore(item.score)}
                </div>
                <div className="search-result-snippet">
                  {highlightMatch(item.snippet || '', query)}
                </div>
              </div>
              {item.timestamp && (
                <div className="search-result-time">
                  {formatChatTime(item.timestamp)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
