import { WAMessageStubType } from '@whiskeysockets/baileys'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../../whatsapp/types'
import { mapBaileysStatus } from '../../whatsapp/ReceiptService'
import { IMessageProcessingContext, IMessageProcessorStrategy, IMessageServiceDependencyAccessor } from './IMessageProcessorStrategy'
import { cleanJid } from '../../../utils/jidUtils'
import { isIndexableMessageType } from '../../../utils/messageUtils'

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

    // Fire-and-forget semantic search indexing. Skip ciphertext placeholders,
    // system stubs and reactions — indexing those pollutes the vector store and
    // a decrypt/edit re-indexes with the real text later. (P2-S2-01)
    if (context.textContent && isIndexableMessageType(context.messageType)) {
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
