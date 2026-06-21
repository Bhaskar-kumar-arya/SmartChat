import { useEffect, useState, useRef } from 'react'
import { Paperclip, Smile, X, Mic, Send, Trash2, StopCircle, Play, Pause } from 'lucide-react'
import { useMentions } from '../../hooks/useMentions'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import MentionMenu from './MentionMenu'
import EmojiStickerGifPicker from '../picker/EmojiStickerGifPicker'
import { useAPI } from '../../context/APIContext'
import { MessageItem } from '../../types/chatTypes'
import { EmojiText } from '../common/EmojiText'
import { emojiToUnified } from '../../utils/emojiUtils'
import {
  getEditableText,
  convertTextToHtml,
  hasRawEmojis,
  getCaretCharacterOffsetWithin,
  setCaretPosition
} from '../../utils/editorUtils'

interface MessageInputProps {
  activeJid: string
  onSend: (text: string, mentions?: string[]) => void | Promise<void>
  onSendMedia: (filePath: string, text: string, mentions?: string[]) => void | Promise<void>
  replyingTo: MessageItem | null
  onCancelReply: () => void
  onAttachFiles?: (paths: string[]) => void
}

export default function MessageInput({ activeJid, onSend, onSendMedia, replyingTo, onCancelReply, onAttachFiles }: MessageInputProps) {
  const api = useAPI()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
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
    if (editorRef.current) {
      editorRef.current.innerHTML = ''
    }
    setText('')
  }, [activeJid])

  useEffect(() => {
    if (replyingTo) {
      editorRef.current?.focus()
    }
  }, [replyingTo])

  useEffect(() => {
    editorRef.current?.focus()
  }, [])

  const handleEditorInput = () => {
    const editor = editorRef.current
    if (!editor) return

    let plainText = getEditableText(editor)
    
    if (plainText === '') {
      editor.innerHTML = ''
    } else {
      if (hasRawEmojis(editor)) {
        const caretOffset = getCaretCharacterOffsetWithin(editor)
        editor.innerHTML = convertTextToHtml(plainText)
        setCaretPosition(editor, caretOffset)
      }
    }

    setText(plainText)
    const caret = getCaretCharacterOffsetWithin(editor)
    handleInputChange(plainText, caret)
  }

  const handleSelectEmoji = (emoji: string) => {
    const editor = editorRef.current
    if (!editor) return

    editor.focus()
    const sel = window.getSelection()
    if (!sel) return

    let range: Range
    if (sel.rangeCount > 0) {
      range = sel.getRangeAt(0)
      if (!editor.contains(range.commonAncestorContainer)) {
        range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false)
      }
    } else {
      range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
    }

    range.deleteContents()

    const unified = emojiToUnified(emoji)
    const img = document.createElement('img')
    img.src = `https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/${unified}.png`
    img.alt = emoji
    img.setAttribute('data-emoji', emoji)
    img.className = 'inline-emoji'
    img.style.width = '20px'
    img.style.height = '20px'
    img.style.verticalAlign = 'middle'
    img.style.display = 'inline-block'
    img.style.margin = '0 1px'

    range.insertNode(img)

    range.setStartAfter(img)
    range.setEndAfter(img)
    sel.removeAllRanges()
    sel.addRange(range)

    handleEditorInput()
  }

  const handleSelectGif = async (filePath: string) => {
    await onSendMedia(filePath, '')
  }

  const handleSelectSticker = async (filePath: string) => {
    await onSendMedia(filePath, '')
  }

  const handleSelectParticipant = (participant: { jid: string, name: string, isAdmin: boolean, isMe: boolean }) => {
    const editor = editorRef.current
    if (!editor) return

    const cursor = getCaretCharacterOffsetWithin(editor)
    const currentText = getEditableText(editor)
    const textBeforeCursor = currentText.slice(0, cursor)
    const lastAtPos = textBeforeCursor.lastIndexOf('@')

    if (lastAtPos !== -1) {
      const number = participant.jid.split('@')[0]
      const newText = currentText.slice(0, lastAtPos) + `@${number} ` + currentText.slice(cursor)
      
      editor.innerHTML = convertTextToHtml(newText)
      setText(newText)
      addMention(participant)
      
      setTimeout(() => {
        editor.focus()
        const newPos = lastAtPos + number.length + 2
        setCaretPosition(editor, newPos)
      }, 0)
    }
  }

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    const mentions = Array.from(mentionedJids)
    
    try {
      await onSend(trimmed, mentions)
      setText('')
      if (editorRef.current) {
        editorRef.current.innerHTML = ''
      }
      clearMentions()
    } finally {
      setSending(false)
      editorRef.current?.focus()
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
      const paths = await api.selectFile()
      if (paths && paths.length > 0 && onAttachFiles) {
        onAttachFiles(paths)
      }
    } catch (err) {
      console.error('Failed to select file:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !showMenu) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSelect = () => {
    const editor = editorRef.current
    if (!editor) return
    const plainText = getEditableText(editor)
    const caret = getCaretCharacterOffsetWithin(editor)
    handleInputChange(plainText, caret)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text/plain')
    if (!pastedText) return

    const html = convertTextToHtml(pastedText)
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    range.deleteContents()

    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = html

    const frag = document.createDocumentFragment()
    let node
    let lastInsertedNode
    while ((node = tempDiv.firstChild)) {
      lastInsertedNode = frag.appendChild(node)
    }
    range.insertNode(frag)

    if (lastInsertedNode) {
      range.setStartAfter(lastInsertedNode)
      range.setEndAfter(lastInsertedNode)
      sel.removeAllRanges()
      sel.addRange(range)
    }

    handleEditorInput()
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
              Replying to <EmojiText text={replyingTo.fromMe ? 'You' : (replyingTo.participantName || 'someone')} />
            </span>
            <p className="reply-preview-text">
              <EmojiText text={replyingTo.textContent || 'Media message'} />
            </p>
          </div>
          <button onClick={onCancelReply} className="reply-preview-close">
            <X size={18} />
          </button>
        </div>
      )}
      

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
    
            <div
              ref={editorRef}
              className="message-input"
              contentEditable={!sending}
              data-placeholder="Type a message..."
              onInput={handleEditorInput}
              onKeyDown={handleKeyDown}
              onSelect={handleSelect}
              onPaste={handlePaste}
              style={{
                maxHeight: '120px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                cursor: 'text'
              }}
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
            onClick={text.trim() ? handleSend : startRecording}
            disabled={sending}
            title={text.trim() ? "Send message" : "Record voice message"}
        >
            {text.trim() ? (
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
