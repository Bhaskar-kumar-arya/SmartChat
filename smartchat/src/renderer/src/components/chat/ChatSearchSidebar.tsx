import React, { useState, useEffect } from 'react'
import { useAPI } from '../../context/APIContext'
import { SearchResultItem, SearchFilters } from '../../types/chatTypes'
import { formatChatTime } from '../../utils/formatters'

interface ChatSearchSidebarProps {
  activeJid: string
  activeName: string
  isOpen: boolean
  onClose: () => void
  onSelectMessage: (messageId: string) => void
}

export default function ChatSearchSidebar({
  activeJid,
  activeName,
  isOpen,
  onClose,
  onSelectMessage
}: ChatSearchSidebarProps): React.ReactNode {
  const api = useAPI()
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Debounced search logic
  useEffect(() => {
    if (!isOpen) return

    if (!query.trim() && !fromDate && !toDate) {
      setResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    const delay = 300
    const timer = setTimeout(async () => {
      try {
        const filters: SearchFilters = {
          jids: [activeJid]
        }
        if (fromDate) {
          filters.fromDate = new Date(fromDate).toISOString()
        }
        if (toDate) {
          filters.toDate = new Date(toDate).toISOString()
        }

        const data = await api.searchAll(query, 'normal', filters)
        setResults(data.messages || [])
      } catch (err: unknown) {
        console.error('[ChatSearchSidebar] Search failed:', err)
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, delay)

    return () => clearTimeout(timer)
  }, [query, fromDate, toDate, activeJid, isOpen])

  const setQuickRange = (range: 'today' | 'week' | 'month' | 'year'): void => {
    const to = new Date()
    const from = new Date()
    if (range === 'today') {
      from.setHours(0, 0, 0, 0)
    } else if (range === 'week') {
      from.setDate(from.getDate() - 7)
    } else if (range === 'month') {
      from.setMonth(from.getMonth() - 1)
    } else if (range === 'year') {
      from.setFullYear(from.getFullYear() - 1)
    }

    // Format to YYYY-MM-DD for standard date input controls
    setFromDate(from.toISOString().split('T')[0])
    setToDate(to.toISOString().split('T')[0])
  }

  const clearFilters = (): void => {
    setQuery('')
    setFromDate('')
    setToDate('')
    setResults([])
  }

  const highlightMatch = (text: string, q: string): React.ReactNode => {
    const term = q.trim()
    if (!term) return <span>{text}</span>
    const idx = text.toLowerCase().indexOf(term.toLowerCase())
    if (idx === -1) return <span>{text}</span>
    return (
      <span>
        {text.slice(0, idx)}
        <mark>{text.slice(idx, idx + term.length)}</mark>
        {text.slice(idx + term.length)}
      </span>
    )
  }

  if (!isOpen) return null

  const hasAnyFilter = !!(query.trim() || fromDate || toDate)

  return (
    <div className="chat-search-sidebar">
      <div className="search-sidebar-header">
        <h3>Search Messages</h3>
        <button className="search-sidebar-close-btn" onClick={onClose} title="Close search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="search-sidebar-content">
        <div className="search-sidebar-search-box">
          <div className="search-sidebar-input-wrapper">
            <span className="search-sidebar-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <input
              type="text"
              className="search-sidebar-input"
              placeholder="Search messages..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button className="search-sidebar-clear-query" onClick={() => setQuery('')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          <div className="filter-section">
            <span className="filter-label">Custom Date Range</span>
            <div className="date-inputs">
              <input
                type="date"
                className="date-input"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                title="Start date"
              />
              <span className="date-separator">to</span>
              <input
                type="date"
                className="date-input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                title="End date"
              />
            </div>

            <div className="quick-ranges">
              <span className="range-chip" onClick={() => setQuickRange('today')}>Today</span>
              <span className="range-chip" onClick={() => setQuickRange('week')}>Last 7d</span>
              <span className="range-chip" onClick={() => setQuickRange('month')}>Last 30d</span>
              <span className="range-chip" onClick={() => setQuickRange('year')}>This Year</span>
              {hasAnyFilter && (
                <span className="range-chip clear" onClick={clearFilters}>Clear Filters</span>
              )}
            </div>
          </div>
        </div>

        <div className="search-result-list">
          {isSearching ? (
            <div className="search-sidebar-empty">
              <div className="spinner-small" />
              <p style={{ marginTop: '8px' }}>Searching messages...</p>
            </div>
          ) : results.length > 0 ? (
            results.map((item) => (
              <div
                key={item.messageId}
                className="search-result-item"
                onClick={() => item.messageId && onSelectMessage(item.messageId)}
              >
                <div className="search-result-content">
                  <div className="search-result-top-row">
                    <span className="search-result-sender-name">
                      {item.senderName || activeName}
                    </span>
                    {item.timestamp && (
                      <span className="search-result-time">
                        {formatChatTime(item.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="search-result-snippet">
                    {highlightMatch(item.snippet || '', query)}
                  </div>
                </div>
              </div>
            ))
          ) : hasAnyFilter ? (
            <div className="search-sidebar-empty">
              <h4>No messages found</h4>
              <p>Try different keywords or adjust date filters</p>
            </div>
          ) : (
            <div className="search-sidebar-empty">
              <h4>Search in {activeName}</h4>
              <p>Type a keyword or filter by date range to find messages</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
