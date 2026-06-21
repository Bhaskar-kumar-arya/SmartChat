import { WAMessageStubType } from '@whiskeysockets/baileys'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../../whatsapp/types'
import { mapBaileysStatus } from '../../whatsapp/ReceiptService'
import { IMessageProcessingContext, IMessageProcessorStrategy, IMessageServiceDependencyAccessor } from './IMessageProcessorStrategy'

export class StandardMessageProcessor implements IMessageProcessorStrategy {
  readonly requiresChat = true

  supports(_context: IMessageProcessingContext): boolean {
    return true // Fallback strategy
  }

  async process(
    context: IMessageProcessingContext,
    dependencies: IMessageServiceDependencyAccessor
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    const isDeleted = context.msg.messageStubType === WAMessageStubType.REVOKE
    const status = mapBaileysStatus(context.msg.status)

    await dependencies.repository.upsertMessage({
      id: context.msg.key.id!,
      chatJid: context.remoteJid,
      fromMe: context.msg.key.fromMe === true,
      senderId: context.senderId,
      participant: context.participantString,
      timestamp: context.timestamp,
      messageType: context.messageType,
      content: JSON.stringify(context.rawMessage ?? {}),
      textContent: context.textContent,
      status: status ?? null,
      isDeleted: isDeleted ?? false
    })

    // Fire-and-forget semantic search indexing
    if (context.textContent && context.messageType !== 'reactionMessage') {
      dependencies.embeddingService.indexMessage(context.msg.key.id!, context.textContent).catch((err: unknown) => {
        console.error('[StandardMessageProcessor] real-time indexing failed:', err)
      })
    }

    const isDeletedResult = context.msg.messageStubType === WAMessageStubType.REVOKE

    return {
      id: context.msg.key.id!,
      chatJid: context.remoteJid,
      fromMe: context.msg.key.fromMe === true,
      senderId: context.senderId,
      participant: context.participantString,
      timestamp: context.timestamp,
      messageType: context.messageType,
      textContent: context.textContent,
      content: JSON.stringify(context.rawMessage ?? {}),
      isDeleted: isDeletedResult,
      isEdited: false,
      status: mapBaileysStatus(context.msg.status)
    }
  }
}
