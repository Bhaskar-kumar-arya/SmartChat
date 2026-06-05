import { useState, useRef, useEffect, useCallback } from 'react'
import { AIChatMessage, AIChatOptions, ToolDefinition } from '../types'
import { api } from '../services/api.service'

interface UseAIStreamProps {
  aiOptions: AIChatOptions
  availableTools: ToolDefinition[]
  activeSessionId: string | null
  saveCurrentMessages: (sessionId: string, messages: AIChatMessage[]) => Promise<void>
}

export function useAIStream({
  aiOptions,
  availableTools,
  activeSessionId,
  saveCurrentMessages
}: UseAIStreamProps) {
  const [messages, setMessages] = useState<AIChatMessage[]>([])
  const messagesRef = useRef<AIChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [executingToolId, setExecutingToolId] = useState<string | null>(null)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)

  const streamingBuffers = useRef<Record<string, string>>({})
  const typingInterval = useRef<any>(null)

  // Keep references to latest options and tools to avoid stale closures in callbacks
  const activeSessionIdRef = useRef<string | null>(activeSessionId)
  const aiOptionsRef = useRef<AIChatOptions>(aiOptions)
  const availableToolsRef = useRef<ToolDefinition[]>(availableTools)

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    aiOptionsRef.current = aiOptions
  }, [aiOptions])

  useEffect(() => {
    availableToolsRef.current = availableTools
  }, [availableTools])

  useEffect(() => {
    return () => {
      if (typingInterval.current) {
        clearInterval(typingInterval.current)
      }
    }
  }, [])

  const startStream = useCallback((
    prompt: string,
    history: AIChatMessage[],
    aiMsgId: string,
    context: any[] = [],
    mentions: any[] = [],
    isSystem: boolean = false
  ) => {
    streamingBuffers.current[aiMsgId] = ''
    setLoading(true)

    const drip = () => {
      if (!typingInterval.current) {
        typingInterval.current = setInterval(() => {
          let hasWork = false
          const updates: Record<string, string> = {}
          for (const key in streamingBuffers.current) {
            const buffer = streamingBuffers.current[key]
            if (buffer && buffer.length > 0) {
              hasWork = true
              const charsToTake = Math.max(2, Math.ceil(buffer.length / 8))
              updates[key] = buffer.substring(0, charsToTake)
              streamingBuffers.current[key] = buffer.substring(charsToTake)
            }
          }
          if (!hasWork) {
            clearInterval(typingInterval.current)
            typingInterval.current = null
            return
          }
          setMessages((p) =>
            p.map((m) =>
              updates[m.id] ? { ...m, content: m.content + updates[m.id] } : m
            )
          )
        }, 30)
      }
    }

    const channelId = api.aiChatStream(
      prompt,
      context,
      history,
      mentions,
      { ...aiOptionsRef.current, isSystem },
      (chunk) => {
        setLoading(false)
        if (streamingBuffers.current[aiMsgId] === undefined) {
          streamingBuffers.current[aiMsgId] = ''
        }
        streamingBuffers.current[aiMsgId] += chunk
        drip()
      },
      () => {
        setLoading(false)
        setActiveChannelId(null)
        const remainder = streamingBuffers.current[aiMsgId]
        delete streamingBuffers.current[aiMsgId]

        let finalContent = ''
        setMessages((p) => {
          const next = p.map((m) => {
            if (m.id === aiMsgId) {
              finalContent = m.content + remainder
              return { ...m, content: finalContent }
            }
            return m
          })
          messagesRef.current = next
          return next
        })

        // Check for auto-executable tool call
        setTimeout(() => {
          const toolMatch = finalContent.match(/<tool_call>([\s\S]*?)<\/tool_call>/)
          if (toolMatch) {
            try {
              let jsonStr = toolMatch[1].trim()
              jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
              const toolData = JSON.parse(jsonStr)
              const tool = availableToolsRef.current.find((t) => t.name === toolData.tool)
              if (tool && tool.requiresPermission === false) {
                executeToolCall(aiMsgId, toolData.tool, toolData.arguments)
              }
            } catch (e) {
              console.error('Failed to parse tool data for auto-exec:', e)
            }
          } else {
            // No tool execution requested, perform auto-save if enabled
            const sid = activeSessionIdRef.current
            if (aiOptionsRef.current.autoSaveChats && sid) {
              saveCurrentMessages(sid, messagesRef.current)
            }
          }
        }, 100)
      },
      (err) => {
        setLoading(false)
        setActiveChannelId(null)
        delete streamingBuffers.current[aiMsgId]
        setMessages((p) => {
          const next = p.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: m.content + '\n\n**Error:** ' + String(err), hasError: true }
              : m
          )
          messagesRef.current = next
          return next
        })
      }
    )
    setActiveChannelId(channelId)
  }, [])

  const executeToolCall = useCallback(async (messageId: string, toolName: string, args: any) => {
    setExecutingToolId(messageId)
    let resultPayload = ''
    try {
      const result = await api.executeTool(toolName, args)
      resultPayload = JSON.stringify(result, null, 2)
    } catch (err: any) {
      resultPayload = JSON.stringify({ error: err.message || String(err) })
    }

    setExecutingToolId(null)
    const sysMsgId = crypto.randomUUID()
    const aiMsgId = crypto.randomUUID()

    const prev = messagesRef.current
    const updated = prev.map((m) => (m.id === messageId ? { ...m, toolResult: resultPayload } : m))

    const nextMessages = [
      ...updated,
      {
        id: sysMsgId,
        role: 'user' as const,
        content: `Tool Execution Result:\n\`\`\`json\n${resultPayload}\n\`\`\`\n\n`,
        isHidden: true,
        isSystem: true
      },
      {
        id: aiMsgId,
        role: 'ai' as const,
        content: '',
        isSystem: false
      }
    ]
    setMessages(nextMessages)
    messagesRef.current = nextMessages

    const prompt = `[SYSTEM] Tool Result:\n\`\`\`json\n${resultPayload}\n\`\`\`\n\nThe tool has completed.`

    startStream(prompt, updated, aiMsgId, [], [], true)
  }, [startStream])

  const declineToolCall = useCallback(async (messageId: string) => {
    const resultPayload = 'User declined tool execution.'
    const sysMsgId = crypto.randomUUID()
    const aiMsgId = crypto.randomUUID()

    const prev = messagesRef.current
    const updated = prev.map((m) => (m.id === messageId ? { ...m, toolResult: resultPayload } : m))

    const nextMessages = [
      ...updated,
      {
        id: sysMsgId,
        role: 'user' as const,
        content: `[SYSTEM] Tool Execution Result: ${resultPayload}\n\nThe user declined this tool execution. Acknowledge and ask how to proceed.`,
        isHidden: true,
        isSystem: true
      },
      {
        id: aiMsgId,
        role: 'ai' as const,
        content: '',
        isSystem: false
      }
    ]

    setMessages(nextMessages)
    messagesRef.current = nextMessages

    const prompt = `Tool declined: ${resultPayload}.\n\nThe user declined the tool execution. Please acknowledge this and proceed with the conversation or tasks as appropriate based on the current context.`

    startStream(prompt, updated, aiMsgId, [], [], true)
  }, [startStream])

  const handleRetry = useCallback((messageId: string) => {
    const msgIndex = messagesRef.current.findIndex((m) => m.id === messageId)
    if (msgIndex === -1 || msgIndex === 0) return

    const aiMsg = messagesRef.current[msgIndex]
    if (aiMsg.role !== 'ai') return

    const triggerMsg = messagesRef.current[msgIndex - 1]
    const history = messagesRef.current.slice(0, msgIndex - 1)

    // Reset AI message state
    const next = messagesRef.current.map((m) =>
      m.id === messageId ? { ...m, content: '', hasError: false } : m
    )
    setMessages(next)
    messagesRef.current = next

    // Restart stream
    startStream(
      triggerMsg.content,
      history,
      messageId,
      [],
      triggerMsg.mentions || [],
      triggerMsg.isSystem
    )
  }, [startStream])

  const abort = useCallback(async () => {
    if (activeChannelId) {
      await api.abortAiChat(activeChannelId)
      setActiveChannelId(null)
      setLoading(false)
    }
  }, [activeChannelId])

  return {
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
    abort
  }
}
