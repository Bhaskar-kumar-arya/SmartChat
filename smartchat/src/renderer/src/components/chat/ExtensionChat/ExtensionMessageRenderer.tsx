import { ReactNode } from 'react'
import { ExtensionChatMessage, ParsedContent } from '../../../types/extension.types'

interface TextBubbleProps { text: string }
function TextBubble({ text }: TextBubbleProps) {
  return <span className="ext-bubble-text">{text}</span>
}

interface CardBlockProps {
  title: string
  body: string
  buttons?: Array<{ id: string; label: string }>
  onButtonClick: (id: string) => void
}
function CardBlock({ title, body, buttons, onButtonClick }: CardBlockProps) {
  return (
    <div className="ext-card-block">
      <div className="ext-card-block__title">{title}</div>
      <div className="ext-card-block__body">{body}</div>
      {buttons && buttons.length > 0 && (
        <div className="ext-card-block__buttons">
          {buttons.map((btn) => (
            <button
              key={btn.id}
              className="ext-button-chip"
              onClick={() => onButtonClick(btn.id)}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// OCP: New content types added by adding entries here — component body not modified.
const RENDERERS: Record<string, (content: ParsedContent, onAction: (id: string) => void) => ReactNode> = {
  text: (c) => <TextBubble text={c.text ?? ''} />,
  button: (c) => <TextBubble text={`[Clicked: ${c.buttonId || 'Unknown'}]`} />,
  card: (c, act) => (
    <CardBlock
      title={c.title ?? ''}
      body={c.body ?? ''}
      buttons={c.buttons}
      onButtonClick={act}
    />
  ),
}

interface ExtensionMessageRendererProps {
  message: ExtensionChatMessage
  onAction: (id: string) => void
}

/**
 * SRP: Only parses content JSON and dispatches to the correct sub-renderer.
 * OCP: Add new content types by adding to RENDERERS map.
 */
export function ExtensionMessageRenderer({ message, onAction }: ExtensionMessageRendererProps) {
  let content: ParsedContent = { type: 'text', text: message.content }
  try {
    const parsed = JSON.parse(message.content)
    if (parsed && typeof parsed === 'object' && parsed.type) {
      content = parsed as ParsedContent
    }
  } catch {
    // If not valid JSON, treat as plain text
  }

  const render = RENDERERS[content.type] ?? ((c: ParsedContent) => <TextBubble text={c.text ?? JSON.stringify(c)} />)
  return <>{render(content, onAction)}</>
}
