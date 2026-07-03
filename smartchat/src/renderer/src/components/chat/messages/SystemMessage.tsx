import { MessageItem as IMessageItem } from '../../../types/chatTypes'
import { SYSTEM_STUB_REGISTRY, SystemMessageContent, formatParticipants } from './system-stubs/SystemStubRegistry'

export function SystemMessageBubble({
  msg,
  onSelectChat
}: {
  msg: IMessageItem
  onSelectChat?: (jid: string, name: string) => void
}) {
  let content: SystemMessageContent
  try {
    content = msg.content ? JSON.parse(msg.content) : { stubType: 'UNKNOWN' }
  } catch (e) {
    content = { stubType: 'UNKNOWN' }
  }

  const renderer = SYSTEM_STUB_REGISTRY[content.stubType]
  // Unknown stubs: try to show participant names if available, else a generic notice.
  // Never expose raw stubType enum keys or JSON blobs to the user.
  const renderedElement = renderer
    ? renderer(content, onSelectChat, msg)
    : (() => {
        const chip = formatParticipants(content.parameters, onSelectChat)
        return chip || <>Group activity</>
      })()

  return (
    <div
      className="system-message-container"
      style={{
        display: 'flex',
        justifyContent: 'center',
        margin: '12px 0',
        width: '100%'
      }}
    >
      <div
        className="system-message-bubble"
        style={{
          background: 'rgba(0, 0, 0, 0.05)',
          color: '#666',
          padding: '6px 14px',
          borderRadius: '8px',
          fontSize: '0.8rem',
          fontWeight: 500,
          textAlign: 'center',
          maxWidth: '85%',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          border: '1px solid rgba(0, 0, 0, 0.03)'
        }}
      >
        {renderedElement}
      </div>
    </div>
  )
}
