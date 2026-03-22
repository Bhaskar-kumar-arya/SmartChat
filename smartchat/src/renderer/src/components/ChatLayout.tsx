import { useState } from 'react'
import ChatList from './ChatList'
import MessageView from './MessageView'
import MessageInput from './MessageInput'

interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  participantName?: string | null
  timestamp: string
  messageType: string
  textContent: string | null
  reactions?: Array<{
    senderId: string
    text: string
    timestamp: string
  }>
}

export default function ChatLayout() {
  const [activeJid, setActiveJid] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string>('')
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null)

  const handleSelectChat = async (jid: string, name: string) => {
    setActiveJid(jid)
    setActiveName(name)
    setLoadingMessages(true)
    setCurrentPage(1)
    setReplyingTo(null)
    
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
      const sentMsg = await window.api.sendMessage(activeJid, text.trim(), replyingTo?.id)
      setMessages((prev) => [...prev, sentMsg])
      setReplyingTo(null)
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }

  const handleSendMediaMessage = async (filePath: string, text: string) => {
    if (!activeJid) return
    try {
      const sentMsg = await window.api.sendMediaMessage(activeJid, filePath, text.trim(), replyingTo?.id)
      setMessages((prev) => [...prev, sentMsg])
      setReplyingTo(null)
    } catch (err) {
      console.error('Failed to send media message:', err)
    }
  }

  const handleDownloadMedia = async (msgId: string) => {
    try {
      const updatedMsg = await window.api.downloadMedia(msgId)
      setMessages((prev) => prev.map((m) => (m.id === msgId ? updatedMsg : m)))
    } catch (err) {
      console.error('Failed to download media:', err)
      throw err // Rethrow to let MessageView catch it for the loading state
    }
  }

  const handleNewMessage = (msg: any) => {
    if (msg.remoteJid === activeJid) {
      if (msg.messageType === 'reactionMessage') {
        try {
          const raw = JSON.parse(msg.content)
          const reaction = raw.reactionMessage
          if (reaction && reaction.key && reaction.key.id) {
            const targetId = reaction.key.id
            const emoji = reaction.text
            const senderId = msg.participant || msg.remoteJid

            setMessages((prev) => 
              prev.map((m) => {
                if (m.id === targetId) {
                  const reactions = m.reactions || []
                  // Remove existing reaction from this sender
                  const filtered = reactions.filter((r) => r.senderId !== senderId)
                  if (emoji) {
                    // Add new reaction if not empty
                    return {
                      ...m,
                      reactions: [...filtered, { senderId, senderName: msg.participantName, text: emoji, timestamp: msg.timestamp }]
                    }
                  }
                  return { ...m, reactions: filtered }
                }
                return m
              })
            )
          }
        } catch (e) {
          console.error('Failed to parse reaction message:', e)
        }
        return
      }

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
