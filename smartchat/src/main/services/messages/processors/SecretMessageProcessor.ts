import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../../whatsapp/types'
import { IMessageProcessingContext, IMessageProcessorStrategy, IMessageServiceDependencyAccessor } from './IMessageProcessorStrategy'

export class SecretMessageProcessor implements IMessageProcessorStrategy {
  readonly requiresChat = false

  supports(context: IMessageProcessingContext): boolean {
    return !!(
      context.msg.message?.secretEncryptedMessage ||
      context.msg.message?.encReactionMessage
    )
  }

  async process(
    context: IMessageProcessingContext,
    dependencies: IMessageServiceDependencyAccessor
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    return dependencies.secretMessageService.handleSecretMessage(
      context.msg as unknown as Parameters<typeof dependencies.secretMessageService.handleSecretMessage>[0],
      context.sock
    )
  }
}
