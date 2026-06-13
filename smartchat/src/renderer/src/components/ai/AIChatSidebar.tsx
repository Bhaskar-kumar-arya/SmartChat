import { useState, useRef, useEffect } from 'react'
import { ChatItem, ModelInfo, AIChatOptions, AIChatMessage, ToolDefinition, SelectedContext, AIContextItem } from '../../types'
import AISmartInput, { AISmartInputRef } from './AISmartInput'
import AIMessageBubble from './AIMessageBubble'
import AISettingsModal from './AISettingsModal'
import AIChatHistoryModal from './AIChatHistoryModal'
import AIChatExportButton from './AIChatExportButton'
import { useAIChatSessions } from './hooks/useAIChatSessions'
import { useAIStream } from './hooks/useAIStream'
import { useAPI } from '../../context/APIContext'

interface AIChatSidebarProps {
  isOpen: boolean
  onClose: () => void
}

export default function AIChatSidebar({ isOpen, onClose }: AIChatSidebarProps) {
  const api = useAPI()
  const [chatList, setChatList] = useState<ChatItem[]>([])
  const [availableTools, setAvailableTools] = useState<ToolDefinition[]>([])
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [tempTitle, setTempTitle] = useState('')
  const [aiOptions, setAiOptions] = useState<AIChatOptions>({
    useThinkMode: true,
    model: 'gemini:gemma-4-31b-it',
    contextLength: 24576,
    autoSaveChats: true
  })

  const handleUpdateOptions = (newOptions: AIChatOptions) => {
    setAiOptions(newOptions)
    api.setAiOptions(newOptions).catch(console.error)
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<AISmartInputRef>(null)

  const {
    sessions,
    activeSessionId,
    isHistoryModalOpen,
    setIsHistoryModalOpen,
    createSession,
    selectSession,
    saveCurrentMessages,
    renameSession,
    deleteSession,
    cloneSession,
    startNewChat
  } = useAIChatSessions()

  const {
    messages,
    setMessages,
    messagesRef,
    loading,
    executingToolId,
    activeChannelId,
    startStream,
    executeToolCall,
    declineToolCall,
    handleRetry,
    abort: handleAbort
  } = useAIStream({
    aiOptions,
    availableTools,
    activeSessionId,
    saveCurrentMessages
  })

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 100)

  useEffect(() => {
    if (isOpen) {
      if (chatList.length === 0) {
        api.getChats(1, 100).then(setChatList).catch(console.error)
      }
      api.getAiTools().then(setAvailableTools).catch(console.error)
      api.getAiModels().then(setAvailableModels).catch(console.error)
      api.getAiOptions().then(setAiOptions).catch(console.error)
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading])

  const handleSend = async (prompt: string, currentMentions: SelectedContext[], overrideHistory?: AIChatMessage[]) => {
    let baseHistory = overrideHistory || messages

    if (!prompt) return

    try {
      const resolvedContexts: AIContextItem[] = []

      // Generate unique IDs synchronously
      const userMessageId = crypto.randomUUID()
      const aiMessageId = crypto.randomUUID()

      // Add both messages atomically
      const newMessages = [
        ...baseHistory,
        {
          id: userMessageId,
          role: 'user' as const,
          content: prompt,
          contexts: resolvedContexts,
          mentions: currentMentions
        },
        {
          id: aiMessageId,
          role: 'ai' as const,
          content: ''
        }
      ]

      setMessages(newMessages)
      messagesRef.current = newMessages

      // Create a session if this is the first message and we don't have an active session
      if (!activeSessionId && baseHistory.length === 0) {
        if (aiOptions.autoSaveChats) {
          await createSession(prompt, aiOptions.model)
        }
      }

      startStream(prompt, baseHistory, aiMessageId, resolvedContexts, currentMentions, false)
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'ai',
          content: 'Sorry, I encountered an error. Please check the console.'
        }
      ])
      console.error(error)
    }
  }


  const handleReRunMessage = (messageId: string) => {
    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex === -1) return
    const msg = messages[msgIndex]

    const truncatedHistory = messages.slice(0, msgIndex)
    handleSend(msg.content, msg.mentions || [], truncatedHistory)
  }

  const handleSaveMessage = (messageId: string, newContent: string, mentions: SelectedContext[]) => {
    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex === -1) return

    const truncatedHistory = messages.slice(0, msgIndex)
    handleSend(newContent, mentions || [], truncatedHistory)
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const handleStartRename = () => {
    if (activeSession) {
      setTempTitle(activeSession.title)
      setIsEditingTitle(true)
    }
  }

  const handleSaveRename = async () => {
    if (activeSessionId && tempTitle.trim() && tempTitle !== activeSession?.title) {
      await renameSession(activeSessionId, tempTitle.trim())
    }
    setIsEditingTitle(false)
  }

  if (!isOpen) return null

  return (
    <div className="ai-sidebar">
      <AIChatHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => {
          setIsHistoryModalOpen(false)
          focusInput()
        }}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => {
          selectSession(id).then((msgs) => {
            setMessages(msgs)
            messagesRef.current = msgs
          })
        }}
        onRenameSession={renameSession}
        onDeleteSession={(id) => {
          deleteSession(id)
          if (activeSessionId === id) {
            setMessages([])
            messagesRef.current = []
          }
        }}
      />
      <AISettingsModal
        isOpen={isSettingsOpen}
        onClose={async () => {
          setIsSettingsOpen(false)
          try {
            const models = await api.getAiModels()
            setAvailableModels(models)
          } catch (e) {
            console.error('[AIChatSidebar] Failed to refresh models:', e)
          }
        }}
        options={aiOptions}
        onOptionsChange={handleUpdateOptions}
        availableModels={availableModels}
      />
      <div className="ai-header">
        <div className="ai-title" onClick={!isEditingTitle ? handleStartRename : undefined}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
            <path d="M12 12 2.1 14.9a10 10 0 0 0 19.8 0L12 12z"></path>
          </svg>
          {isEditingTitle ? (
            <input
              autoFocus
              className="ai-title-input"
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={handleSaveRename}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h3 title="Click to rename">{activeSession?.title || 'AI Assistant'}</h3>
          )}
        </div>
        <div className="ai-header-actions">
          <button
            className="ai-close-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <AIChatExportButton
            activeSessionId={activeSessionId}
            messages={messages}
            sessions={sessions}
            onSessionCloned={(id) => {
              return selectSession(id).then((msgs) => {
                setMessages(msgs)
                messagesRef.current = msgs
                focusInput()
              })
            }}
            cloneSession={cloneSession}
            focusInput={focusInput}
          />
          <button
            className="ai-close-btn"
            onClick={() => setIsHistoryModalOpen(true)}
            title="History"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
          <button
            className="ai-close-btn"
            onClick={async () => {
              setMessages([])
              messagesRef.current = []
              startNewChat()
              setIsHistoryModalOpen(false)
              focusInput()
            }}
            title="New Chat"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button className="ai-close-btn" onClick={onClose} title="Close Sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div className="ai-messages">
        {messages.length === 0 ? (
          <div className="ai-empty-state">
            <p>How can I help you today?</p>
            <span>Type @ to mention a contact.</span>
          </div>
        ) : (
          messages.filter(m => !m.isHidden).map(msg => (
            <AIMessageBubble
              key={msg.id}
              message={msg}
              availableTools={availableTools}
              isExecuting={executingToolId === msg.id}
              onApprove={executeToolCall}
              onDecline={declineToolCall}
              onRetry={() => handleRetry(msg.id)}
              onReRun={handleReRunMessage}
              onSave={handleSaveMessage}
              chatList={chatList}
            />
          ))
        )}
        {loading && (
          <div className="ai-message-bubble ai loading">
            <div className="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <AISmartInput
        ref={inputRef}
        chatList={chatList}
        onSend={handleSend}
        disabled={loading || !!activeChannelId}
        onAbort={handleAbort}
        aiOptions={aiOptions}
        availableModels={availableModels}
      />
    </div>
  )
}
