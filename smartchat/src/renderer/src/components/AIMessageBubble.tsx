import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import AIToolCard from './AIToolCard'

interface AIChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  contexts?: any[]
  mentions?: any[]
  isHidden?: boolean
  toolResult?: string
  hasError?: boolean
}

interface AIMessageBubbleProps {
  message: AIChatMessage
  availableTools: any[]
  isExecuting: boolean
  onApprove: (messageId: string, tool: string, args: any) => void
  onDecline: (messageId: string) => void
  onRetry: () => void
}

const AIMessageBubble: React.FC<AIMessageBubbleProps> = ({ 
  message, 
  availableTools,
  isExecuting, 
  onApprove, 
  onDecline,
  onRetry
}) => {
  if (message.isHidden) return null

  const toolMatch = message.content.match(/<tool_call>([\s\S]*?)<\/tool_call>/)
  let toolData: any = null
  if (toolMatch) {
    try { 
      toolData = JSON.parse(toolMatch[1]) 
    } catch (e) {
      console.error('Failed to parse tool data:', e)
    }
  }

  return (
    <div className={`ai-message-bubble ${message.role}`}>
      <div className="ai-message-content markdown-body">
        {toolData && (
          <AIToolCard
            toolData={toolData}
            toolResult={message.toolResult}
            isExecuting={isExecuting}
            requiresPermission={availableTools.find(t => t.name === toolData.tool)?.requiresPermission !== false}
            onApprove={() => onApprove(message.id, toolData.tool, toolData.arguments)}
            onDecline={() => onDecline(message.id)}
          />
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {toolData ? message.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '') : message.content}
        </ReactMarkdown>
        {message.hasError && (
          <button className="retry-button" onClick={onRetry}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

export default AIMessageBubble
