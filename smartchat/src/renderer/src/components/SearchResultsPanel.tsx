import { SearchResultItem } from '../types'
import { formatChatTime } from '../utils/formatters'

interface SearchResultsPanelProps {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
  isSearching: boolean
  query: string
  activeJid: string | null
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
  onSelectChat
}: SearchResultsPanelProps) {
  const hasResults = chats.length > 0 || messages.length > 0

  if (isSearching) {
    return (
      <div className="search-results-panel">
        <div className="search-results-loading">
          <div className="spinner" />
          <span>Searching...</span>
        </div>
      </div>
    )
  }

  if (!hasResults) {
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
                <div className="search-result-name">{item.name}</div>
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
