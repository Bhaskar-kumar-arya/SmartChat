import { useEffect, useState, useRef } from 'react'
import { Paperclip, Smile, X, Mic, Send, Trash2, StopCircle, Play, Pause } from 'lucide-react'
import { useMentions } from '../../hooks/useMentions'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import MentionMenu from './MentionMenu'
import EmojiStickerGifPicker from '../picker/EmojiStickerGifPicker'
import { useAPI } from '../../context/APIContext'
import { MessageItem } from '../../types'

interface MessageInputProps {
  activeJid: string
  onSend: (text: string, mentions?: string[]) => void | Promise<void>
  onSendMedia: (filePath: string, text: string, mentions?: string[]) => void | Promise<void>
  replyingTo: MessageItem | null
  onCancelReply: () => void
}

export default function MessageInput({ activeJid, onSend, onSendMedia, replyingTo, onCancelReply }: MessageInputProps) {
  const api = useAPI()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{path: string, name: string} | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerContainerRef = useRef<HTMLDivElement>(null)
  const smileButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setShowPicker(false)
  }, [activeJid])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        showPicker &&
        pickerContainerRef.current &&
        !pickerContainerRef.current.contains(event.target as Node) &&
        smileButtonRef.current &&
        !smileButtonRef.current.contains(event.target as Node)
      ) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPicker])

  const { 
    participants, 
    showMenu, 
    query, 
    mentionedJids, 
    handleInputChange, 
    addMention, 
    clearMentions 
  } = useMentions(activeJid)
  
  const { 
    isRecording, 
    duration, 
    audioBlob, 
    visualizerData, 
    isPlayingPreview,
    startRecording, 
    stopRecording, 
    cancelRecording,
    togglePreviewPlayback,
    stopPreview
  } = useAudioRecorder()

  useEffect(() => {
    if (replyingTo) {
      inputRef.current?.focus()
    }
  }, [replyingTo])

  const handleSelectEmoji = (emoji: string) => {
    if (!inputRef.current) return
    const input = inputRef.current
    const start = input.selectionStart || 0
    const end = input.selectionEnd || 0
    const val = input.value
    const newVal = val.substring(0, start) + emoji + val.substring(end)
    setText(newVal)
    
    // Restore cursor position
    setTimeout(() => {
      input.focus()
      const newPos = start + emoji.length
      input.setSelectionRange(newPos, newPos)
    }, 0)
  }

  const handleSelectGif = async (filePath: string) => {
    await onSendMedia(filePath, '')
  }

  const handleSelectSticker = async (filePath: string) => {
    await onSendMedia(filePath, '')
  }

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

  const handleCancelRecording = () => {
    cancelRecording()
  }

  const handleSendVoice = async () => {
    if (!audioBlob || sending) return
    
    stopPreview()
    setSending(true)
    try {
      const arrayBuffer = await audioBlob.arrayBuffer()
      const fileName = `voice_${Date.now()}.ogg`
      const filePath = await api.saveTempFile(arrayBuffer, fileName)
      
      await onSendMedia(filePath, '', [])
      cancelRecording() // Reset state
    } catch (err) {
      console.error('Failed to send voice message:', err)
    } finally {
      setSending(false)
    }
  }

  const handleAttachClick = async () => {
    try {
      const path = await api.selectFile()
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
    <div className="message-input-wrapper">
      {showMenu && (
        <MentionMenu 
          participants={participants} 
          query={query} 
          onSelect={handleSelectParticipant} 
          onClose={() => handleInputChange(text, 0)} 
        />
      )}

      {replyingTo && (
        <div className="reply-preview">
          <div className="reply-preview-content">
            <span className="reply-preview-title">
              Replying to {replyingTo.participantName || 'someone'}
            </span>
            <p className="reply-preview-text">
              {replyingTo.textContent || 'Media message'}
            </p>
          </div>
          <button onClick={onCancelReply} className="reply-preview-close">
            <X size={18} />
          </button>
        </div>
      )}
      
      {selectedFile && (() => {
        const ext = selectedFile.name.split('.').pop()?.toLowerCase() || ''
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
        const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)
        const localUrl = `app://local/${encodeURIComponent(selectedFile.path)}`

        return (
          <div className="draft-preview-container">
            <div className="draft-preview-card">
              {isImage ? (
                <img src={localUrl} alt="Preview" className="draft-preview-media" />
              ) : isVideo ? (
                <video src={localUrl} className="draft-preview-media" muted playsInline autoPlay loop />
              ) : (
                <div className="draft-preview-doc">
                  <svg className="draft-preview-doc-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14.5 2 14.5 7.5 20 7.5"/></svg>
                  <span className="draft-preview-doc-ext">{ext || 'file'}</span>
                </div>
              )}
            </div>
            
            <div className="draft-preview-meta">
              <span className="draft-preview-title">{selectedFile.name}</span>
              <span className="draft-preview-subtitle">
                {isImage ? 'Image attachment' : isVideo ? 'Video attachment' : 'Document attachment'}
              </span>
            </div>

            <button onClick={() => setSelectedFile(null)} className="draft-preview-close" title="Remove attachment">
              <X size={16} />
            </button>
          </div>
        )
      })()}


      {showPicker && (
        <div className="picker-popover-container" ref={pickerContainerRef}>
          <EmojiStickerGifPicker
            onSelectEmoji={handleSelectEmoji}
            onSelectGif={handleSelectGif}
            onSelectSticker={handleSelectSticker}
            onClose={() => setShowPicker(false)}
          />
        </div>
      )}

      <div className="message-input-container">
        {!isRecording && !audioBlob ? (
          <>
            <button 
              className="recording-action-btn"
              onClick={handleAttachClick}
              disabled={sending}
              title="Attach file"
            >
              <Paperclip size={24} />
            </button>

            <button 
              ref={smileButtonRef}
              type="button"
              className={`recording-action-btn ${showPicker ? 'active' : ''}`}
              onClick={() => setShowPicker(!showPicker)}
              disabled={sending}
              title="Emojis, Stickers, GIFs"
            >
              <Smile size={24} />
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
          </>
        ) : (
          <div className="recording-container">
            <button className="recording-action-btn danger" onClick={handleCancelRecording}>
                <Trash2 size={20} />
            </button>
            
            {audioBlob && (
              <button className="recording-action-btn" onClick={togglePreviewPlayback}>
                {isPlayingPreview ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>
            )}

            <div className="recording-stats">
                {!audioBlob && <div className="recording-dot" />}
                <span className="recording-timer">
                    {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}
                </span>
                <div className="recording-visualizer">
                    {visualizerData.slice(0, 20).map((v, i) => (
                        <div key={i} className="visualizer-bar" style={{ height: `${Math.max(v * 100, 10)}%` }} />
                    ))}
                </div>
            </div>
            {audioBlob ? (
                <button className="recording-action-btn success" onClick={handleSendVoice}>
                    <Send size={24} />
                </button>
            ) : (
                <button className="recording-action-btn success" onClick={stopRecording}>
                    <StopCircle size={24} />
                </button>
            )}
          </div>
        )}

      {!isRecording && !audioBlob && (
        <button
            className="send-button"
            onClick={text.trim() || selectedFile ? handleSend : startRecording}
            disabled={sending}
            title={text.trim() || selectedFile ? "Send message" : "Record voice message"}
        >
            {text.trim() || selectedFile ? (
                <Send size={24} />
            ) : (
                <Mic size={24} />
            )}
        </button>
      )}
      </div>
    </div>
  )
}
