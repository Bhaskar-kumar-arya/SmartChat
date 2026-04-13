import { useState, useCallback } from 'react'
import ChatList from './ChatList'
import MessageView from './MessageView'
import MessageInput from './MessageInput'
import { useMessages } from '../hooks/useMessages'
import { usePresence } from '../hooks/usePresence'
import { MessageItem } from '../types'
import { ProfilePicture } from './ProfilePicture'
import { ProfilePicOverlay } from './ProfilePicOverlay'
import AIChatSidebar from './AIChatSidebar'
import '../assets/sidebar.css'

export default function ChatLayout() {
  const [activeJid, setActiveJid] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string>('')
  const [activeProfilePic, setActiveProfilePic] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null)
  const [overlayJid, setOverlayJid] = useState<string | null>(null)
  const [overlayName, setOverlayName] = useState<string>('')
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null)
  const [isAIOpen, setIsAIOpen] = useState<boolean>(false)
  const [sidebarWidth, setSidebarWidth] = useState<number>(500)

  const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault()
    const startX = mouseDownEvent.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (mouseMoveEvent: MouseEvent) => {
      const delta = startX - mouseMoveEvent.clientX
      const newWidth = Math.min(Math.max(startWidth + delta, 300), 800)
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  const { 
    messages, 
    loading: loadingMessages, 
    loadMore, 
    handleDownloadMedia, 
    sendMessage, 
    sendMediaMessage,
    editMessage,
    deleteMessage
  } = useMessages(activeJid)

  const { getActivePresence } = usePresence()

  const handleSelectChat = (jid: string, name: string, profilePictureUrl?: string | null, messageId?: string | null) => {
    setActiveJid(jid)
    setActiveName(name)
    setActiveProfilePic(profilePictureUrl || null)
    setReplyingTo(null)
    setTargetMessageId(messageId || null)
  }

  const handleSendMessage = async (text: string, mentions?: string[]) => {
    await sendMessage(text, replyingTo?.id, mentions)
    setReplyingTo(null)
  }

  const handleSendMediaMessage = async (filePath: string, text: string, mentions?: string[]) => {
    await sendMediaMessage(filePath, text, replyingTo?.id, mentions)
    setReplyingTo(null)
  }

  const activePresenceText = getActivePresence(activeJid)

  const openOverlay = (jid: string, name: string) => {
    setOverlayJid(jid)
    setOverlayName(name)
  }

  return (
    <div className="chat-layout">
      <ChatList
        activeJid={activeJid}
        onSelectChat={handleSelectChat}
        onShowProfilePic={openOverlay}
      />
      <div className="chat-main">
        {activeJid ? (
          <>
            <div className="chat-header">
              <ProfilePicture 
                jid={activeJid} 
                initialUrl={activeProfilePic} 
                size={40} 
                onClick={() => openOverlay(activeJid, activeName)}
              />
              <div className="chat-header-info">
                <h2 className="chat-header-name">{activeName}</h2>
                {activePresenceText && (
                  <p className={`chat-header-status ${activePresenceText === 'online' ? '' : 'presence-typing'}`}>
                    {activePresenceText}
                  </p>
                )}
                {!activePresenceText && <p className="chat-header-jid">{activeJid}</p>}
              </div>
            </div>
            <MessageView
              messages={messages}
              loading={loadingMessages}
              onLoadMore={loadMore}
              onReply={(msg) => setReplyingTo(msg)}
              onEdit={editMessage}
              onDelete={deleteMessage}
              onDownloadMedia={handleDownloadMedia}
              targetMessageId={targetMessageId}
              onTargetScrolled={() => setTargetMessageId(null)}
            />
            <MessageInput
              onSend={handleSendMessage}
              onSendMedia={handleSendMediaMessage}
              activeJid={activeJid}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
            />
          </>
        ) : (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2>SmartChat</h2>
            <p>Select a conversation to start messaging</p>
          </div>
        )}
      </div>

      {isAIOpen && (
        <div 
          className="ai-sidebar-resizer"
          onMouseDown={startResizing}
          style={{ right: `${sidebarWidth}px` }}
        />
      )}

      <AIChatSidebar isOpen={isAIOpen} onClose={() => setIsAIOpen(false)} width={sidebarWidth} />

      <button 
        className={`ai-edge-tab ${isAIOpen ? 'open' : ''}`}
        onClick={() => setIsAIOpen(!isAIOpen)}
        title={isAIOpen ? "Close AI Assistant" : "Open AI Assistant"}
        style={isAIOpen ? { right: `${sidebarWidth}px` } : {}}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isAIOpen ? <polyline points="9 18 15 12 9 6"></polyline> : <polyline points="15 18 9 12 15 6"></polyline>}
        </svg>
      </button>

      {overlayJid && (
        <ProfilePicOverlay 
          jid={overlayJid} 
          name={overlayName} 
          onClose={() => setOverlayJid(null)} 
        />
      )}
    </div>
  )
}
