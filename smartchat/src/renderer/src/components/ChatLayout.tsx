import { useState } from 'react'
import ChatList from './ChatList'
import MessageView from './MessageView'
import MessageInput from './MessageInput'
import { useMessages } from '../hooks/useMessages'
import { usePresence } from '../hooks/usePresence'
import { MessageItem } from '../types'
import { ProfilePicture } from './ProfilePicture'
import { ProfilePicOverlay } from './ProfilePicOverlay'

export default function ChatLayout() {
  const [activeJid, setActiveJid] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string>('')
  const [activeProfilePic, setActiveProfilePic] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null)
  const [overlayJid, setOverlayJid] = useState<string | null>(null)
  const [overlayName, setOverlayName] = useState<string>('')
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null)

  const { 
    messages, 
    loading: loadingMessages, 
    loadMore, 
    handleDownloadMedia, 
    sendMessage, 
    sendMediaMessage 
  } = useMessages(activeJid)

  const { getActivePresence } = usePresence()

  const handleSelectChat = (jid: string, name: string, profilePictureUrl?: string | null, messageId?: string | null) => {
    setActiveJid(jid)
    setActiveName(name)
    setActiveProfilePic(profilePictureUrl || null)
    setReplyingTo(null)
    setTargetMessageId(messageId || null)
  }

  const handleSendMessage = async (text: string) => {
    await sendMessage(text, replyingTo?.id)
    setReplyingTo(null)
  }

  const handleSendMediaMessage = async (filePath: string, text: string) => {
    await sendMediaMessage(filePath, text, replyingTo?.id)
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
              onDownloadMedia={handleDownloadMedia}
              targetMessageId={targetMessageId}
              onTargetScrolled={() => setTargetMessageId(null)}
            />
            <MessageInput
              onSend={handleSendMessage}
              onSendMedia={handleSendMediaMessage}
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
