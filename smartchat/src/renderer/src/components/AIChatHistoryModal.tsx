import { useState } from 'react'
import { AIChatSessionItem } from '../types'

interface AIChatHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  sessions: AIChatSessionItem[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onRenameSession: (id: string, newTitle: string) => void
  onDeleteSession: (id: string) => void
}

export default function AIChatHistoryModal({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onRenameSession,
  onDeleteSession
}: AIChatHistoryModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  if (!isOpen) return null

  const handleStartEdit = (e: React.MouseEvent, session: AIChatSessionItem) => {
    e.stopPropagation()
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const handleSaveEdit = (e?: React.MouseEvent | React.KeyboardEvent, id?: string) => {
    if (e) e.stopPropagation()
    const targetId = id || editingId
    if (targetId && editTitle.trim()) {
      onRenameSession(targetId, editTitle.trim())
    }
    setEditingId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      handleSaveEdit(e, id)
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setConfirmDeleteId(id)
  }

  const confirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmDeleteId) {
      onDeleteSession(confirmDeleteId)
      setConfirmDeleteId(null)
    }
  }

  // Helper to format date nicely
  const formatDate = (msString: string) => {
    const d = new Date(Number(msString))
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (days === 1) return 'Yesterday'
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div className="ai-modal-overlay" onClick={onClose}>
      <div className="ai-modal-container" onClick={e => e.stopPropagation()}>
        {confirmDeleteId && (
          <div className="ai-modal-confirm-overlay">
            <p className="ai-modal-confirm-text">Delete this session?</p>
            <div className="ai-modal-btn-group">
              <button
                className="ai-modal-btn cancel"
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
              >Cancel</button>
              <button
                className="ai-modal-btn delete"
                onClick={confirmDelete}
              >Delete</button>
            </div>
          </div>
        )}

        <div className="ai-modal-header">
          <h3>Chat History</h3>
          <button className="ai-modal-close-icon-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="ai-history-list">
          {sessions.length === 0 ? (
            <div className="ai-history-empty">
              No chat history yet.
            </div>
          ) : (
            <>
              {sessions.map(session => (
                <div 
                  key={session.id} 
                  className={`ai-history-item ${activeSessionId === session.id ? 'active' : ''}`}
                  onClick={() => { onSelectSession(session.id); onClose(); }}
                >
                  <div className="ai-history-item-header">
                    {editingId === session.id ? (
                      <input 
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => handleSaveEdit()}
                        onKeyDown={(e) => handleKeyDown(e, session.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ 
                          background: 'var(--wa-header-bg)', color: 'white', border: '1px solid var(--wa-primary)',
                          borderRadius: '4px', padding: '2px 4px', fontSize: '14px', width: '100%' 
                        }}
                      />
                    ) : (
                      <>
                        <span className="ai-history-item-title">{session.title}</span>
                        <div className="ai-history-item-actions">
                          <button 
                            className="ai-history-item-btn" 
                            onClick={(e) => handleStartEdit(e, session)}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                          </button>
                          <button 
                            className="ai-history-item-btn delete" 
                            onClick={(e) => handleDelete(e, session.id)}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="ai-history-item-meta">
                    <span>{session.modelId}</span>
                    <span>{formatDate(session.updatedAt)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
