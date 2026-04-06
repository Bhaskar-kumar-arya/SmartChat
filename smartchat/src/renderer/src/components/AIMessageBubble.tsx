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
}

interface AIMessageBubbleProps {
  message: AIChatMessage
  isExecuting: boolean
  onApprove: (messageId: string, tool: string, args: any) => void
  onDecline: (messageId: string) => void
}

const AIMessageBubble: React.FC<AIMessageBubbleProps> = ({ 
  message, 
  isExecuting, 
  onApprove, 
  onDecline 
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
        {toolData ? (
          <AIToolCard
            toolData={toolData}
            toolResult={message.toolResult}
            isExecuting={isExecuting}
            onApprove={() => onApprove(message.id, toolData.tool, toolData.arguments)}
            onDecline={() => onDecline(message.id)}
          />
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        )}
      </div>
    </div>
  )
}

export default AIMessageBubble
