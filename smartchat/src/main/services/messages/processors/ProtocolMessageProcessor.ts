import { classifyProtocolType, extractEditedText } from '../../../utils/messageUtils'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult, WAMessageKey } from '../../whatsapp/types'
import { IMessageProcessingContext, IMessageProcessorStrategy, IMessageServiceDependencyAccessor } from './IMessageProcessorStrategy'

export class ProtocolMessageProcessor implements IMessageProcessorStrategy {
  readonly requiresChat = false

  supports(context: IMessageProcessingContext): boolean {
    return context.messageType === 'protocolMessage' && !!context.unwrapped
  }

  async process(
    context: IMessageProcessingContext,
    _dependencies: IMessageServiceDependencyAccessor
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    const protocol = context.unwrapped?.protocolMessage
    const targetId = protocol?.key?.id
    if (targetId && protocol) {
      try {
        const kind = classifyProtocolType(protocol.type)
        if (kind === 'revoke') {
          return {
            type: 'protocol',
            subType: 'revoke',
            targetId,
            chatJid: context.remoteJid,
            key: protocol.key as WAMessageKey
          }
        } else if (kind === 'edit') {
          const editedMsg = protocol.editedMessage
          const editContent = extractEditedText(editedMsg)
          return {
            type: 'protocol',
            subType: 'edit',
            targetId,
            chatJid: context.remoteJid,
            key: protocol.key as WAMessageKey,
            editedTextContent: editContent,
            editedContent: editedMsg ?? null
          }
        }
      } catch (err: unknown) {
        console.error('[ProtocolMessageProcessor] Error handling protocol message:', err)
      }
    }
    return null
  }
}
