import React, { useState } from 'react'
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
  const [thoughtExpanded, setThoughtExpanded] = useState(false)

  if (message.isHidden) return null

  // Extract <thought> or <think> block
  const thoughtMatch = message.content.match(/<(thought|think)>([\s\S]*?)<\/\1>/)
  const thoughtContent = thoughtMatch ? thoughtMatch[2].trim() : null

  // Extract <tool_call> block
  const toolMatch = message.content.match(/<tool_call>([\s\S]*?)<\/tool_call>/)
  let toolData: any = null
  if (toolMatch) {
    try { 
      toolData = JSON.parse(toolMatch[1]) 
    } catch (e) {
      console.error('Failed to parse tool data:', e)
    }
  }

  // Clean the display content: strip thought/think and <tool_call> blocks
  const displayContent = message.content
    .replace(/<(thought|think)>[\s\S]*?<\/\1>/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim()

  return (
    <div className={`ai-message-bubble ${message.role}`}>
      <div className="ai-message-content markdown-body">
        {/* Thought block — collapsible pill */}
        {thoughtContent && (
          <div className="ai-thought-block">
            <button
              className="ai-thought-toggle"
              onClick={() => setThoughtExpanded(p => !p)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
              </svg>
              <span>Thinking{thoughtExpanded ? '' : '...'}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                style={{ transform: thoughtExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {thoughtExpanded && (
              <div className="ai-thought-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{thoughtContent}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Tool card */}
        {toolData && (
          <AIToolCard
            toolData={toolData}
            toolResult={message.toolResult}
            isExecuting={isExecuting}
            requiresPermission={availableTools.find(t => t.name === toolData.tool)?.requiresPermission !== false}
            onApprove={() => {
              const args = toolData.arguments !== undefined 
                ? toolData.arguments 
                : Object.fromEntries(Object.entries(toolData).filter(([k]) => k !== 'tool'));
              onApprove(message.id, toolData.tool, args);
            }}
            onDecline={() => onDecline(message.id)}
          />
        )}

        {/* Main response text */}
        {displayContent && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
        )}

        {message.hasError && (
          <button className="retry-button" onClick={onRetry}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6"/>
              <path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

export default AIMessageBubble
