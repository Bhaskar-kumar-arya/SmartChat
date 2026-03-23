import { useState } from 'react'
import ChatList from './ChatList'
import MessageView from './MessageView'
import MessageInput from './MessageInput'
import { useMessages } from '../hooks/useMessages'
import { usePresence } from '../hooks/usePresence'
import { MessageItem } from '../types'

export default function ChatLayout() {
  const [activeJid, setActiveJid] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string>('')
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null)

  const { 
    messages, 
    loading: loadingMessages, 
    loadMore, 
    handleDownloadMedia, 
    sendMessage, 
    sendMediaMessage 
  } = useMessages(activeJid)

  const { getActivePresence } = usePresence()

  const handleSelectChat = (jid: string, name: string) => {
    setActiveJid(jid)
    setActiveName(name)
    setReplyingTo(null)
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

  return (
    <div className="chat-layout">
      <ChatList
        activeJid={activeJid}
        onSelectChat={handleSelectChat}
      />
      <div className="chat-main">
        {activeJid ? (
          <>
            <div className="chat-header">
              <div className="chat-header-avatar">
                {activeName.charAt(0).toUpperCase()}
              </div>
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
    </div>
  )
}
