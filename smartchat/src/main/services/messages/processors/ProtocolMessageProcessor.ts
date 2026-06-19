import { ProcessedMessage } from '../../../domain/types'
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
    const protocol = context.unwrapped.protocolMessage as Record<string, unknown> | undefined
    const targetId = (protocol?.key as { id?: string } | undefined)?.id
    if (targetId && protocol) {
      try {
        const type = protocol.type
        if (type === 0 || type === 'REVOKE') {
          return {
            type: 'protocol',
            subType: 'revoke',
            targetId,
            chatJid: context.remoteJid,
            key: protocol.key as any
          }
        } else if (type === 14 || type === 'MESSAGE_EDIT') {
          const editedMsg = protocol.editedMessage as Record<string, unknown> | undefined
          const editContent =
            (editedMsg?.conversation as string | undefined) ??
            ((editedMsg?.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined) ??
            ((editedMsg?.imageMessage as Record<string, unknown> | undefined)?.caption as string | undefined) ??
            ((editedMsg?.videoMessage as Record<string, unknown> | undefined)?.caption as string | undefined) ??
            null
          return {
            type: 'protocol',
            subType: 'edit',
            targetId,
            chatJid: context.remoteJid,
            key: protocol.key as any,
            editedTextContent: editContent,
            editedContent: editedMsg as any
          }
        }
      } catch (err: unknown) {
        console.error('[ProtocolMessageProcessor] Error handling protocol message:', err)
      }
    }
    return null
  }
}
