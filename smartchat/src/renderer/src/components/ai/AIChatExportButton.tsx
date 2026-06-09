import { useState } from 'react'
import { api } from '../../services/api.service'

interface AIChatExportButtonProps {
  activeSessionId: string | null
  messages: any[]
  sessions: any[]
  onSessionCloned?: (newSessionId: string) => void
  cloneSession?: (id: string) => Promise<any>
  focusInput?: () => void
}

export default function AIChatExportButton({ 
  activeSessionId, 
  messages, 
  sessions, 
  onSessionCloned,
  cloneSession,
  focusInput
}: AIChatExportButtonProps) {
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [exported, setExported] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  const handleExport = async () => {
    if (!activeSessionId || messages.length === 0) return
    
    setExporting(true)
    try {
      const session = sessions.find(s => s.id === activeSessionId) || { id: activeSessionId, title: 'Untitled' }
      await api.exportAiChat(session, messages)
      setExported(true)
      setTimeout(() => setExported(false), 2000)
      focusInput?.()
    } catch (e) {
      console.error('Export failed', e)
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async () => {
    if (!activeSessionId) return
    setShowConfirmDelete(true)
  }

  const confirmDelete = async () => {
    if (!activeSessionId) return
    
    setDeleting(true)
    setShowConfirmDelete(false)
    try {
      await api.deleteExportedAiChat(activeSessionId)
      focusInput?.()
    } catch (e) {
      console.error('Delete failed', e)
    } finally {
      setDeleting(false)
    }
  }

  const handleClone = async () => {
    if (!activeSessionId || !cloneSession) return
    
    setCloning(true)
    try {
      const newSession = await cloneSession(activeSessionId)
      if (newSession && onSessionCloned) {
        await onSessionCloned(newSession.id)
      }
    } catch (e) {
      console.error('Clone failed', e)
    } finally {
      setCloning(false)
    }
  }

  return (
    <>
      {showConfirmDelete && (
        <div className="ai-modal-overlay" onClick={() => setShowConfirmDelete(false)}>
          <div className="ai-modal-container" onClick={e => e.stopPropagation()} style={{ maxWidth: '300px' }}>
            <div className="ai-modal-confirm-overlay" style={{ position: 'static', padding: '20px' }}>
              <p className="ai-modal-confirm-text">Remove from exports?</p>
              <div className="ai-modal-btn-group">
                <button
                  className="ai-modal-btn cancel"
                  onClick={() => setShowConfirmDelete(false)}
                >Cancel</button>
                <button
                  className="ai-modal-btn delete"
                  onClick={confirmDelete}
                >Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        background: 'rgba(0,0,0,0.1)', 
        borderRadius: '6px', 
        padding: '2px',
        border: '1px solid var(--wa-border)'
      }}>
        <button 
          className="ai-close-btn" 
          onClick={handleExport}
          disabled={exporting || !activeSessionId || messages.length === 0}
          title="Export/Update JSON"
          style={{ color: exported ? 'var(--wa-primary)' : 'var(--wa-text-secondary)', padding: '4px' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>

        <button 
          className="ai-close-btn" 
          onClick={handleClone}
          disabled={cloning || !activeSessionId}
          title="Clone Session"
          style={{ color: 'var(--wa-text-secondary)', padding: '4px' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        
        <div style={{ width: '1px', height: '14px', background: 'var(--wa-border)', margin: '0 2px' }} />

        <button 
          className="ai-close-btn" 
          onClick={handleDelete}
          disabled={deleting || !activeSessionId}
          title="Remove from JSON"
          style={{ color: '#ef4444', padding: '4px' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    </>
  )
}
