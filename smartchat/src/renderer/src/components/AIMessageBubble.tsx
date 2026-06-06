import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'

// ── Mention highlighter for rendered bubbles ──────────────────────────────────
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderWithMentions(content: string, mentions: any[]): React.ReactNode {
  if (!mentions || mentions.length === 0) {
    return <ReactMarkdown>{content}</ReactMarkdown>
  }
  const sorted = [...mentions].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))
  const pattern = sorted.map((m: any) => escapeRe(`@${m.name}`)).join('|')
  const regex = new RegExp(`(${pattern})`, 'g')
  const parts = content.split(regex)
  // If no splits happened, just use markdown
  if (parts.length === 1) return <ReactMarkdown>{content}</ReactMarkdown>

  return (
    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((part, i) => {
        const hit = mentions.find((m: any) => `@${m.name}` === part)
        return hit
          ? <span key={i} className="ai-bubble-mention">{part}</span>
          : <span key={i}>{part}</span>
      })}
    </span>
  )
}
import remarkGfm from 'remark-gfm'
import AIToolCard from './AIToolCard'
import AISmartInput from './AISmartInput'

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
  onReRun?: (messageId: string) => void
  onSave?: (messageId: string, newContent: string, mentions: any[]) => void
  chatList: any[]
}

const AIMessageBubble: React.FC<AIMessageBubbleProps> = ({ 
  message, 
  availableTools,
  isExecuting, 
  onApprove, 
  onDecline,
  onRetry,
  onReRun,
  onSave,
  chatList
}) => {
  const [thoughtExpanded, setThoughtExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  if (message.isHidden) return null

  // Extract <thought> or <think> block
  const thoughtMatch = message.content.match(/<(thought|think)>([\s\S]*?)<\/\1>/)
  const thoughtContent = thoughtMatch ? thoughtMatch[2].trim() : null

  // Extract <tool_call> block
  const toolMatch = message.content.match(/<tool_call>([\s\S]*?)<\/tool_call>/)
  let toolData: any = null
  let parseError: string | null = null
  if (toolMatch) {
    try { 
      let jsonStr = toolMatch[1].trim()
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      toolData = JSON.parse(jsonStr) 
    } catch (e: any) {
      console.error('Failed to parse tool data:', e)
      parseError = e.message || String(e)
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
                className={`ai-thought-arrow ${thoughtExpanded ? 'expanded' : ''}`}
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

        {/* Tool parse error */}
        {!toolData && parseError && toolMatch && (
           <div className="ai-tool-error">
              <strong>Failed to parse tool call</strong>
              <p>{parseError}</p>
              <pre>{toolMatch[1].trim()}</pre>
           </div>
        )}

        {/* Main response text */}
        {isEditing ? (
          <div className="ai-message-edit-container">
            <AISmartInput
              chatList={chatList}
              onSend={(newContent, mentions) => {
                onSave?.(message.id, newContent, mentions);
                setIsEditing(false);
              }}
              onCancel={() => setIsEditing(false)}
              externalValue={{
                prompt: message.content,
                mentions: message.mentions || []
              }}
            />
            <div className="ai-edit-actions">
              <span className="ai-edit-hint">ESC to cancel</span>
              <button 
                className="ai-cancel-btn" 
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {displayContent && (
              message.role === 'user' && message.mentions && message.mentions.length > 0
                ? renderWithMentions(displayContent, message.mentions)
                : <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
            )}

            {message.role === 'user' && (
              <div className="ai-message-actions">
                <button 
                  className="ai-action-btn" 
                  onClick={() => setIsEditing(true)}
                  title="Edit"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
                <button 
                  className="ai-action-btn" 
                  onClick={() => onReRun?.(message.id)}
                  title="Re-run"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6"></path>
                    <path d="M1 20v-6h6"></path>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                </button>
              </div>
            )}
          </>
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
