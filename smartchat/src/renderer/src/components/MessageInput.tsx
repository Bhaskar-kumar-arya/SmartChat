import { useEffect, useState, useRef } from 'react'
import { Paperclip, X } from 'lucide-react'
import { useMentions } from '../hooks/useMentions'
import MentionMenu from './MentionMenu'

interface MessageItem {
  id: string
  textContent: string | null
  participantName?: string | null
  [key: string]: any
}

interface MessageInputProps {
  activeJid: string
  onSend: (text: string, mentions?: string[]) => void | Promise<void>
  onSendMedia: (filePath: string, text: string, mentions?: string[]) => void | Promise<void>
  replyingTo: MessageItem | null
  onCancelReply: () => void
}

export default function MessageInput({ activeJid, onSend, onSendMedia, replyingTo, onCancelReply }: MessageInputProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{path: string, name: string} | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { 
    participants, 
    showMenu, 
    query, 
    mentionedJids, 
    handleInputChange, 
    addMention, 
    clearMentions 
  } = useMentions(activeJid)

  useEffect(() => {
    if (replyingTo) {
      inputRef.current?.focus()
    }
  }, [replyingTo])

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setText(val)
    handleInputChange(val, e.target.selectionStart || 0)
  }

  const handleSelectParticipant = (participant: { jid: string, name: string, isAdmin: boolean, isMe: boolean }) => {
    const cursor = inputRef.current?.selectionStart || 0
    const textBeforeCursor = text.slice(0, cursor)
    const lastAtPos = textBeforeCursor.lastIndexOf('@')

    if (lastAtPos !== -1) {
      const number = participant.jid.split('@')[0]
      const newText = text.slice(0, lastAtPos) + `@${number} ` + text.slice(cursor)
      setText(newText)
      addMention(participant)
      
      // Move cursor after the mention
      setTimeout(() => {
        if (inputRef.current) {
          const newPos = lastAtPos + number.length + 2
          inputRef.current.focus()
          inputRef.current.setSelectionRange(newPos, newPos)
        }
      }, 0)
    }
  }

  const handleSend = async () => {
    const trimmed = text.trim()
    if ((!trimmed && !selectedFile) || sending) return

    setSending(true)
    const mentions = Array.from(mentionedJids)
    
    try {
      if (selectedFile) {
        await onSendMedia(selectedFile.path, trimmed, mentions)
      } else {
        await onSend(trimmed, mentions)
      }
      setText('')
      setSelectedFile(null)
      clearMentions()
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleAttachClick = async () => {
    try {
      const path = await window.api.selectFile()
      if (path) {
        const name = path.split(/[\\/]/).pop() || 'File'
        setSelectedFile({ path, name })
        inputRef.current?.focus()
      }
    } catch (err) {
      console.error('Failed to select file:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !showMenu) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="message-input-wrapper" style={{ display: 'flex', flexDirection: 'column', width: '100%', borderTop: '1px solid var(--border, #e5e5e5)', position: 'relative' }}>
      {showMenu && (
        <MentionMenu 
          participants={participants} 
          query={query} 
          onSelect={handleSelectParticipant} 
          onClose={() => handleInputChange(text, 0)} 
        />
      )}

      {replyingTo && (
        <div className="reply-preview" style={{ padding: '8px 16px', backgroundColor: '#f0f2f5', borderLeft: '4px solid var(--primary, #00a884)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary, #00a884)' }}>
              Replying to {replyingTo.participantName || 'someone'}
            </span>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {replyingTo.textContent || 'Media message'}
            </p>
          </div>
          <button onClick={onCancelReply} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888' }}>
            <X size={18} />
          </button>
        </div>
      )}
      
      {selectedFile && (
        <div className="file-preview" style={{ padding: '8px 16px', backgroundColor: '#e9edef', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.9rem', color: '#333' }}>📎 {selectedFile.name} attached</span>
          <button onClick={() => setSelectedFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888' }}>
            <X size={18} />
          </button>
        </div>
      )}

      <div className="message-input-container" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button 
          className="attach-button"
          onClick={handleAttachClick}
          disabled={sending}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#54656f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px' }}
          title="Attach file"
        >
          <Paperclip size={24} />
        </button>

        <input
          ref={inputRef}
          type="text"
          className="message-input"
          placeholder={selectedFile ? "Add a caption..." : "Type a message..."}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onSelect={(e) => handleInputChange(text, (e.target as HTMLInputElement).selectionStart || 0)}
          disabled={sending}
          autoFocus
        />
      <button
        className="send-button"
        onClick={handleSend}
        disabled={(!text.trim() && !selectedFile) || sending}
        title="Send message"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      </button>
      </div>
    </div>
  )
}
