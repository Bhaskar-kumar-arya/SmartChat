import { WAMessageStubType } from '@whiskeysockets/baileys'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../../whatsapp/types'
import { mapBaileysStatus } from '../../whatsapp/ReceiptService'
import { IMessageProcessingContext, IMessageProcessorStrategy, IMessageServiceDependencyAccessor } from './IMessageProcessorStrategy'
import { ISocketUserContext } from '../../contacts/IContactService'

export class ReactionMessageProcessor implements IMessageProcessorStrategy {
  readonly requiresChat = true

  /**
   * Resolve the "me" identity id for a fromMe reaction. Mirrors
   * MessageIdentityResolver.resolveMeSenderId: prefer the persisted me-identity,
   * otherwise fall back to the socket user's JID / LID. (P2-S2-04)
   */
  private async resolveMeReactorId(
    dependencies: IMessageServiceDependencyAccessor,
    sock: ISocketUserContext | null
  ): Promise<number | null> {
    const meIdent = await dependencies.identityRepository.findMeIdentity()
    if (meIdent) return meIdent.id

    const myRawJid = sock?.user?.id
    const myJidClean = myRawJid ? myRawJid.split(':')[0] : null
    if (myJidClean) {
      const byId = await dependencies.contactService.getIdentityIdByJid(myJidClean)
      if (byId) return byId
      const myLid = sock?.user?.lid ? sock.user.lid.split(':')[0] : null
      if (myLid) {
        const byLid = await dependencies.contactService.getIdentityIdByJid(myLid)
        if (byLid) return byLid
      }
    }
    return null
  }

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
      // context.senderId is always null for fromMe. Resolve the "me" identity,
      // falling back to the socket user JID/LID when the identity row has not
      // been persisted yet (early in a fresh login). (P2-S2-04)
      reactorId = await this.resolveMeReactorId(dependencies, context.sock)
    }

    if (targetId && reactorId !== null) {
      await dependencies.reactionRepository.upsertReaction(targetId, reactorId, emoji ?? null, context.timestamp)
    }

    const isDeleted = context.msg.messageStubType === WAMessageStubType.REVOKE

    return {
      id: context.msg.key.id!,
      chatJid: context.remoteJid,
      fromMe: context.msg.key.fromMe === true,
      senderId: reactorId ?? context.senderId,
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
