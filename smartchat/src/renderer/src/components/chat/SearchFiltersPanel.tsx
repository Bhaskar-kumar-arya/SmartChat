import { useState } from 'react'
import { SearchFilters, SearchMode } from '../../types/chatTypes'

interface SearchFiltersPanelProps {
  filters: SearchFilters
  onFiltersChange: (filters: SearchFilters) => void
  chats: { jid: string; name: string }[]
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
}

/**
 * SRP: This component solely manages the search filters UI.
 * Handles chat multi-select and date range picking.
 */
export function SearchFiltersPanel({ 
  filters, 
  onFiltersChange, 
  chats,
  mode,
  onModeChange
}: SearchFiltersPanelProps) {
  const [showChatDropdown, setShowChatDropdown] = useState(false)
  const [dropdownSearch, setDropdownSearch] = useState('')

  const toggleJid = (jid: string) => {
    const currentJids = filters.jids || []
    const newJids = currentJids.includes(jid)
      ? currentJids.filter((j) => j !== jid)
      : [...currentJids, jid]
    onFiltersChange({ ...filters, jids: newJids.length > 0 ? newJids : undefined })
  }

  const selectAllFiltered = () => {
    const filteredJids = filteredDropdownChats.map(c => c.jid)
    const currentJids = filters.jids || []
    const combined = [...new Set([...currentJids, ...filteredJids])]
    onFiltersChange({ ...filters, jids: combined })
  }

  const clearAllSelected = () => {
    onFiltersChange({ ...filters, jids: undefined })
  }

  const filteredDropdownChats = chats.filter(c => 
    c.name.toLowerCase().includes(dropdownSearch.toLowerCase()) ||
    c.jid.toLowerCase().includes(dropdownSearch.toLowerCase())
  ).slice(0, 100)

  const setQuickRange = (range: 'today' | 'week' | 'month' | 'year') => {
    const to = new Date()
    const from = new Date()
    if (range === 'today') from.setHours(0, 0, 0, 0)
    else if (range === 'week') from.setDate(from.getDate() - 7)
    else if (range === 'month') from.setMonth(from.getMonth() - 1)
    else if (range === 'year') from.setFullYear(from.getFullYear() - 1)

    onFiltersChange({
      ...filters,
      fromDate: from.toISOString(),
      toDate: to.toISOString()
    })
  }

  return (
    <div className="search-filters-panel">
      <div className="filter-section">
        <label className="filter-label">Search Mode</label>
        <label className="dropdown-item mode-toggle-item" style={{ padding: '0 4px' }}>
          <input 
            type="checkbox" 
            checked={mode === 'deep'} 
            onChange={(e) => onModeChange(e.target.checked ? 'deep' : 'normal')}
            style={{ width: '18px', height: '18px' }}
          />
          <span style={{ fontWeight: 600, color: mode === 'deep' ? 'var(--wa-primary)' : 'inherit' }}>
            Deep Search ✦
          </span>
        </label>
        <div className="mode-desc" style={{ fontSize: '0.65rem', color: 'var(--wa-text-tertiary)', marginTop: '-4px', marginLeft: '28px' }}>
          Search by meaning using local AI models.
        </div>
      </div>

      <div className="filter-section">
        <label className="filter-label">Chats / Contacts</label>
        <div className="custom-dropdown">
          <button 
            className="dropdown-toggle"
            onClick={() => setShowChatDropdown(!showChatDropdown)}
          >
            {filters.jids?.length 
              ? `${filters.jids.length} selected` 
              : 'All chats'}
          </button>
          
          {showChatDropdown && (
            <div className="dropdown-menu">
              <div className="dropdown-search-item">
                <input 
                  type="text" 
                  placeholder="Filter chats..." 
                  className="dropdown-search"
                  value={dropdownSearch}
                  onChange={(e) => setDropdownSearch(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              </div>
              <div className="dropdown-actions">
                <button 
                  className="dropdown-action-btn" 
                  onClick={(e) => { e.stopPropagation(); selectAllFiltered(); }}
                >
                  Select All
                </button>
                <button 
                  className="dropdown-action-btn" 
                  onClick={(e) => { e.stopPropagation(); clearAllSelected(); }}
                >
                  Clear
                </button>
              </div>
              <div className="dropdown-list">
                {filteredDropdownChats.length === 0 ? (
                  <div className="dropdown-empty-text">No matching chats</div>
                ) : filteredDropdownChats.map(chat => (
                  <label key={chat.jid} className="dropdown-item" onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      checked={filters.jids?.includes(chat.jid)}
                      onChange={() => toggleJid(chat.jid)}
                    />
                    <span>{chat.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="filter-section">
        <label className="filter-label">Date Range</label>
        <div className="date-inputs">
          <input 
            type="date" 
            value={filters.fromDate?.split('T')[0] || ''}
            onChange={(e) => onFiltersChange({ ...filters, fromDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
            className="date-input"
          />
          <span className="date-separator">to</span>
          <input 
            type="date" 
            value={filters.toDate?.split('T')[0] || ''}
            onChange={(e) => onFiltersChange({ ...filters, toDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
            className="date-input"
          />
        </div>
        <div className="quick-ranges">
          <button className="range-chip" onClick={() => setQuickRange('today')}>Today</button>
          <button className="range-chip" onClick={() => setQuickRange('week')}>Last 7d</button>
          <button className="range-chip" onClick={() => setQuickRange('month')}>Last 30d</button>
          <button className="range-chip" onClick={() => setQuickRange('year')}>This Year</button>
          {(filters.fromDate || filters.toDate) && (
             <button className="range-chip clear" onClick={() => onFiltersChange({ ...filters, fromDate: undefined, toDate: undefined })}>Clear</button>
          )}
        </div>
      </div>
    </div>
  )
}
