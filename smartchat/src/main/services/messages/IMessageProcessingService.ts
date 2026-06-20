import { ProcessedMessage } from '../../domain/types'
import { ProtocolResult } from '../whatsapp/types'

export interface IMessageProcessingService {
  processMessage(
    msg: unknown,
    sock: unknown | null
  ): Promise<ProcessedMessage | ProtocolResult | null>

  processReaction(
    reactionUpdate: unknown,
    sock: unknown | null
  ): Promise<void>
}
