import { useEffect, useState, useRef } from 'react'
import { Paperclip, X, Mic, Send, Trash2, StopCircle, Play, Pause } from 'lucide-react'
import { useMentions } from '../hooks/useMentions'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import MentionMenu from './MentionMenu'
import { api } from '../services/api.service'
import { MessageItem } from '../types'

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
  
  const { 
    isRecording, 
    duration, 
    audioBlob, 
    visualizerData, 
    startRecording, 
    stopRecording, 
    cancelRecording 
  } = useAudioRecorder()
  
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)

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

  const stopPreview = () => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause()
      audioPreviewRef.current.currentTime = 0
      setIsPlayingPreview(false)
    }
  }

  const togglePreviewPlayback = () => {
    if (!audioBlob) return

    if (isPlayingPreview) {
      stopPreview()
    } else {
      if (!audioPreviewRef.current) {
        audioPreviewRef.current = new Audio()
        audioPreviewRef.current.onended = () => setIsPlayingPreview(false)
      }
      
      const url = URL.createObjectURL(audioBlob)
      audioPreviewRef.current.src = url
      audioPreviewRef.current.play()
      setIsPlayingPreview(true)
    }
  }

  const handleCancelRecording = () => {
    stopPreview()
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
      
      {selectedFile && (
        <div className="file-preview">
          <span className="file-preview-text">📎 {selectedFile.name} attached</span>
          <button onClick={() => setSelectedFile(null)} className="file-preview-close">
            <X size={18} />
          </button>
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
