import { WAMessageStubType } from '@whiskeysockets/baileys'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../../whatsapp/types'
import { mapBaileysStatus } from '../../whatsapp/ReceiptService'
import { IMessageProcessingContext, IMessageProcessorStrategy, IMessageServiceDependencyAccessor } from './IMessageProcessorStrategy'
import { cleanJid } from '../../../utils/jidUtils'

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

    const myId = context.sock?.user?.id ? cleanJid(context.sock.user.id) : null
    const myLid = context.sock?.user?.lid ? cleanJid(context.sock.user.lid) : null
    const cleanedRemote = cleanJid(context.remoteJid)
    const isSelfChat = (myId && cleanedRemote === myId) || (myLid && cleanedRemote === myLid)
    const status = isSelfChat ? 'READ' : mapBaileysStatus(context.msg.status)

    const saved = await dependencies.repository.upsertMessage({
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
      messageType: saved.messageType,
      textContent: saved.textContent,
      content: saved.content,
      isDeleted: isDeletedResult,
      isEdited: false,
      status
    }
  }
}
