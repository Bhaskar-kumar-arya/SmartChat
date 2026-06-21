import { proto } from '@whiskeysockets/baileys'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../../whatsapp/types'
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
        const type = protocol.type as unknown as number | string
        if (type === 0 || type === 'REVOKE') {
          return {
            type: 'protocol',
            subType: 'revoke',
            targetId,
            chatJid: context.remoteJid,
            key: protocol.key as proto.IMessageKey
          }
        } else if (type === 14 || type === 'MESSAGE_EDIT') {
          const editedMsg = protocol.editedMessage
          const editContent =
            editedMsg?.conversation ??
            editedMsg?.extendedTextMessage?.text ??
            editedMsg?.imageMessage?.caption ??
            editedMsg?.videoMessage?.caption ??
            null
          return {
            type: 'protocol',
            subType: 'edit',
            targetId,
            chatJid: context.remoteJid,
            key: protocol.key as proto.IMessageKey,
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
