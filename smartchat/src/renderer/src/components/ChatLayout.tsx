import { useState } from 'react'
import ChatList from './ChatList'
import MessageView from './MessageView'
import MessageInput from './MessageInput'

interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  timestamp: string
  messageType: string
  textContent: string | null
}

export default function ChatLayout() {
  const [activeJid, setActiveJid] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string>('')
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const handleSelectChat = async (jid: string, name: string) => {
    setActiveJid(jid)
    setActiveName(name)
    setLoadingMessages(true)
    setCurrentPage(1)
    
    // Clear unread badge locally
    window.api.markRead(jid).catch(err => console.error('Failed to mark read:', err))

    try {
      const msgs = await window.api.getMessages(jid, 1, 50)
      setMessages(msgs)
    } catch (err) {
      console.error('Failed to load messages:', err)
      setMessages([])
    } finally {
      setLoadingMessages(false)
    }
  }

  const handleSendMessage = async (text: string) => {
    if (!activeJid || !text.trim()) return
    try {
      const sentMsg = await window.api.sendMessage(activeJid, text.trim())
      setMessages((prev) => [...prev, sentMsg])
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }

  const handleNewMessage = (msg: MessageItem) => {
    if (msg.remoteJid === activeJid) {
      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
    }
  }

  const handleLoadMore = async () => {
    if (!activeJid) return 0
    const nextPage = currentPage + 1
    try {
      const olderMsgs = await window.api.getMessages(activeJid, nextPage, 50)
      if (olderMsgs.length > 0) {
        setCurrentPage(nextPage)
        setMessages((prev) => [...olderMsgs, ...prev])
      }
      return olderMsgs.length
    } catch (err) {
      console.error('Failed to load more messages:', err)
      return 0
    }
  }

  return (
    <div className="chat-layout">
      <ChatList
        activeJid={activeJid}
        onSelectChat={handleSelectChat}
        onNewMessage={handleNewMessage}
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
                <p className="chat-header-jid">{activeJid}</p>
              </div>
            </div>
            <MessageView
              messages={messages}
              loading={loadingMessages}
              onLoadMore={handleLoadMore}
            />
            <MessageInput onSend={handleSendMessage} />
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
