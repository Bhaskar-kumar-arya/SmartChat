import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../../whatsapp/types'
import { IMessageProcessorStrategy } from './IMessageProcessorStrategy'

/**
 * Classifies reaction messages so they are never treated as standard messages.
 *
 * It deliberately persists nothing and returns `null` (so no `message:incoming`
 * is emitted): Baileys also fires `messages.reaction` for every reaction, and
 * `MessageService.processReaction` (reaction:update -> ReceiptSubscriber) is the
 * single reaction writer and emitter (reaction:processed). (R-MSG-06)
 */
export class ReactionMessageProcessor implements IMessageProcessorStrategy {
  readonly requiresChat = true

  supports(context: Parameters<IMessageProcessorStrategy['supports']>[0]): boolean {
    return context.messageType === 'reactionMessage' && !!context.rawMessage
  }

  async process(): Promise<ProcessedMessage | ProtocolResult | null> {
    return null
  }
}
