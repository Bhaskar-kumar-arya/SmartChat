import { WAMessageStubType } from '@whiskeysockets/baileys'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../../whatsapp/types'
import { mapBaileysStatus } from '../../whatsapp/ReceiptService'
import { IMessageProcessingContext, IMessageProcessorStrategy, IMessageServiceDependencyAccessor } from './IMessageProcessorStrategy'

export class ReactionMessageProcessor implements IMessageProcessorStrategy {
  readonly requiresChat = true

  supports(context: IMessageProcessingContext): boolean {
    return context.messageType === 'reactionMessage' && !!context.rawMessage
  }

  async process(
    context: IMessageProcessingContext,
    dependencies: IMessageServiceDependencyAccessor
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    const reactionMsg = context.rawMessage?.reactionMessage
    const targetId = reactionMsg?.key?.id
    const emoji = reactionMsg?.text

    let reactorId = context.senderId
    if (context.msg.key.fromMe) {
      const meIdent = await dependencies.identityRepository.findMeIdentity()
      if (meIdent) reactorId = meIdent.id
    }

    if (targetId && reactorId !== null) {
      await dependencies.reactionRepository.upsertReaction(targetId, reactorId, emoji ?? null, context.timestamp)
    }

    const isDeleted = context.msg.messageStubType === WAMessageStubType.REVOKE

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
      isDeleted,
      isEdited: false,
      status: mapBaileysStatus(context.msg.status)
    }
  }
}
