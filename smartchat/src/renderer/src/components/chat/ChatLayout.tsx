import { useState, useCallback, useEffect } from 'react'
import { useAPI } from '../../context/APIContext'
import ChatList from './ChatList'
import MessageView from './MessageView'
import MessageInput from './MessageInput'
import { useMessages } from './hooks/useMessages'
import { usePresence } from '../../hooks/usePresence'
import { MessageItem } from '../../types/chatTypes'
import { ProfilePicture } from '../common/ProfilePicture'
import { ProfilePicOverlay } from '../common/ProfilePicOverlay'
import { AIChatSidebar } from '../ai'
import ChatSearchSidebar from './ChatSearchSidebar'
import '../../styles/sidebar.css'
import { useDragAndDrop } from '../../hooks/useDragAndDrop'
import { useMultiFileQueue } from '../../hooks/useMultiFileQueue'
import DragDropOverlay from './DragDropOverlay'
import MultiFilePreview from './MultiFilePreview'
import { EmojiText } from '../common/EmojiText'
import { useSidebarResize } from './hooks/useSidebarResize'

export default function ChatLayout() {
  const api = useAPI()
  const [activeJid, setActiveJid] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string>('')
  const [activeProfilePic, setActiveProfilePic] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null)
  const [overlayJid, setOverlayJid] = useState<string | null>(null)
  const [overlayName, setOverlayName] = useState<string>('')
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null)
  const [isAIOpen, setIsAIOpen] = useState<boolean>(false)
  const [isChatSearchOpen, setIsChatSearchOpen] = useState<boolean>(false)
  const { sidebarWidth, startResizing } = useSidebarResize(500)

  const {
    messages,
    loading: loadingMessages,
    isJumping,
    loadMore,
    jumpToMessage,
    handleDownloadMedia,
    sendMessage,
    sendMediaMessage,
    editMessage,
    deleteMessage
  } = useMessages(activeJid, targetMessageId)

  const { getActivePresence } = usePresence()

  const {
    stagedFiles,
    selectedIndex,
    setSelectedIndex,
    addFiles,
    removeFile,
    updateCaption,
    clearQueue
  } = useMultiFileQueue()

  const { isDraggingOver, dragHandlers } = useDragAndDrop({
    onFilesDropped: addFiles,
    disabled: !activeJid
  })

  const [sendingFiles, setSendingFiles] = useState(false)

  const handleSendMultiMedia = useCallback(async () => {
    if (stagedFiles.length === 0 || sendingFiles) return
    setSendingFiles(true)
    try {
      await Promise.all(
        stagedFiles.map(file =>
          sendMediaMessage(file.path, file.caption, replyingTo?.id)
        )
      )
      clearQueue()
      setReplyingTo(null)
    } catch (err) {
      console.error('Failed to send multiple media files:', err)
    } finally {
      setSendingFiles(false)
    }
  }, [stagedFiles, sendingFiles, sendMediaMessage, replyingTo, clearQueue])

  const handleAddMoreFiles = useCallback(async () => {
    try {
      const paths = await api.selectFile()
      if (paths && paths.length > 0) {
        addFiles(paths)
      }
    } catch (err) {
      console.error('Failed to select file:', err)
    }
  }, [addFiles, api])

  const handleSelectChat = useCallback((jid: string, name: string, profilePictureUrl?: string | null, messageId?: string | null) => {
    setActiveJid(jid)
    setActiveName(name)
    setActiveProfilePic(profilePictureUrl || null)
    setReplyingTo(null)
    setTargetMessageId(messageId || null)
  }, [])

  useEffect(() => {
    api.setActiveChat(activeJid).catch(console.error)
  }, [activeJid, api])

  useEffect(() => {
    const unsubscribe = api.onOpenChat((chat) => {
      handleSelectChat(chat.jid, chat.name)
    })
    return () => {
      unsubscribe()
    }
  }, [handleSelectChat, api])

  useEffect(() => {
    const handler = (e: Event) => {
      const { jid, targetMessageId: newTarget } = (e as CustomEvent<{ jid: string; targetMessageId?: string }>).detail
      const chatName = '' // ChatList resolves name from its own data
      
      // If we are already in this chat and just need to jump to a message
      if (activeJid === jid && newTarget) {
        jumpToMessage(newTarget).then(() => {
          setTargetMessageId(newTarget)
        })
      } else {
        handleSelectChat(jid, chatName, null, newTarget ?? null)
      }
    }
    window.addEventListener('smartchat:open-chat', handler)
    return () => window.removeEventListener('smartchat:open-chat', handler)
  }, [handleSelectChat, activeJid, jumpToMessage])

  useEffect(() => {
    if (!activeJid) return
    const unsubscribe = api.onChatUpdated((update) => {
      if (update.jid === activeJid) {
        if (update.name !== undefined) {
          setActiveName(update.name)
        }
        if (update.profilePictureUrl !== undefined) {
          setActiveProfilePic(update.profilePictureUrl)
        }
      }
    })
    return () => {
      unsubscribe()
    }
  }, [activeJid, api])

  const handleSendMessage = useCallback(async (text: string, mentions?: string[]) => {
    await sendMessage(text, replyingTo?.id, mentions)
    setReplyingTo(null)
  }, [sendMessage, replyingTo])

  const handleSendMediaMessage = useCallback(async (filePath: string, text: string, mentions?: string[]) => {
    await sendMediaMessage(filePath, text, replyingTo?.id, mentions)
    setReplyingTo(null)
  }, [sendMediaMessage, replyingTo])

  const activePresenceText = getActivePresence(activeJid)

  const openOverlay = useCallback((jid: string, name: string) => {
    setOverlayJid(jid)
    setOverlayName(name)
  }, [])

  const handleReply = useCallback((msg: MessageItem) => setReplyingTo(msg), [])
  const handleTargetScrolled = useCallback(() => setTargetMessageId(null), [])
  const handleCancelReply = useCallback(() => setReplyingTo(null), [])
  const handleCloseAI = useCallback(() => setIsAIOpen(false), [])
  const handleCloseSearch = useCallback(() => setIsChatSearchOpen(false), [])
  const handleCloseOverlay = useCallback(() => setOverlayJid(null), [])

  // Jump to a specific message efficiently using the backend anchor query.
  // Sidebar stays open so users can jump between multiple results.
  const handleSelectSearchMessage = useCallback(async (messageId: string) => {
    await jumpToMessage(messageId)
    setTargetMessageId(messageId)
  }, [jumpToMessage])



  const handleToggleAI = useCallback(() => {
    setIsAIOpen((prev) => {
      const next = !prev
      if (next) setIsChatSearchOpen(false)
      return next
    })
  }, [])

  const handleToggleSearch = useCallback(() => {
    setIsChatSearchOpen((prev) => {
      const next = !prev
      if (next) setIsAIOpen(false)
      return next
    })
  }, [])

  const handleHeaderProfileClick = useCallback(() => {
    if (activeJid) openOverlay(activeJid, activeName)
  }, [activeJid, activeName, openOverlay])

  return (
    <div className="chat-layout" style={{ '--ai-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
      <ChatList
        activeJid={activeJid}
        onSelectChat={handleSelectChat}
        onShowProfilePic={openOverlay}
      />
      <div className="chat-main" {...dragHandlers}>
        {activeJid ? (
          <>
            <DragDropOverlay isVisible={isDraggingOver} />
            <div className="chat-header">
              <ProfilePicture
                jid={activeJid}
                initialUrl={activeProfilePic}
                size={40}
                onClick={handleHeaderProfileClick}
              />
              <div className="chat-header-info">
                <h2 className="chat-header-name"><EmojiText text={activeName} /></h2>
                {activePresenceText && (
                  <p className={`chat-header-status ${activePresenceText === 'online' ? '' : 'presence-typing'}`}>
                    {activePresenceText}
                  </p>
                )}
                {!activePresenceText && <p className="chat-header-jid">{activeJid}</p>}
              </div>
              <div className="chat-header-actions">
                <button
                  className={`search-header-btn ${isChatSearchOpen ? 'active' : ''}`}
                  onClick={handleToggleSearch}
                  title="Search messages"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </button>
              </div>
            </div>
            <MessageView
              messages={messages}
              loading={loadingMessages}
              isJumping={isJumping}
              onLoadMore={loadMore}
              onReply={handleReply}
              onEdit={editMessage}
              onDelete={deleteMessage}
              onDownloadMedia={handleDownloadMedia}
              targetMessageId={targetMessageId}
              onTargetScrolled={handleTargetScrolled}
              onScrollToMessage={handleSelectSearchMessage}
              onSelectChat={handleSelectChat}
            />
            <MessageInput
              onSend={handleSendMessage}
              onSendMedia={handleSendMediaMessage}
              activeJid={activeJid}
              replyingTo={replyingTo}
              onCancelReply={handleCancelReply}
              onAttachFiles={addFiles}
            />
            <MultiFilePreview
              files={stagedFiles}
              selectedIndex={selectedIndex}
              onSelectFile={setSelectedIndex}
              onRemoveFile={removeFile}
              onAddMore={handleAddMoreFiles}
              onCaptionChange={updateCaption}
              onSend={handleSendMultiMedia}
              onClose={clearQueue}
              sending={sendingFiles}
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

      {(isAIOpen || isChatSearchOpen) && (
        <div
          className="ai-sidebar-resizer"
          onMouseDown={startResizing}
        />
      )}

      <AIChatSidebar isOpen={isAIOpen} onClose={handleCloseAI} />

      {activeJid && (
        <ChatSearchSidebar
          activeJid={activeJid}
          activeName={activeName}
          isOpen={isChatSearchOpen}
          onClose={handleCloseSearch}
          onSelectMessage={handleSelectSearchMessage}
        />
      )}

      <button
        className={`ai-edge-tab ${isAIOpen ? 'open' : ''}`}
        onClick={handleToggleAI}
        title={isAIOpen ? "Close AI Assistant" : "Open AI Assistant"}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isAIOpen ? <polyline points="9 18 15 12 9 6"></polyline> : <polyline points="15 18 9 12 15 6"></polyline>}
        </svg>
      </button>

      {overlayJid && (
        <ProfilePicOverlay
          jid={overlayJid}
          name={overlayName}
          onClose={handleCloseOverlay}
        />
      )}
    </div>
  )
}
