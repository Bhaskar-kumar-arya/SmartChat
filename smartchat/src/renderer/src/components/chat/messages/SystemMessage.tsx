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
    : msg.messageType === 'call' || msg.messageType === 'callLogMesssage' || msg.messageType === 'scheduledCallCreationMessage'
      ? (() => {
        const callLog = (content as any).callLog
        if (callLog) {
          return <>📞 {callLog.isVideo ? 'Video' : 'Voice'} Call {callLog.isGroup ? '(Group)' : ''}</>
        }
        return <>📞 Call</>
      })()
      : (() => {
        const chip = formatParticipants(content.parameters, onSelectChat)
        return chip || <>Group activity</>
      })()

  return (
    <div className="system-message-container">
      <div className="system-message-bubble">
        {renderedElement}
      </div>
    </div>
  )
}
