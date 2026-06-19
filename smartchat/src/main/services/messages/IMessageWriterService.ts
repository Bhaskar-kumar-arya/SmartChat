import { BaileysMessage, ProtocolResult, BaileysReactionUpdate, WASocket } from '../whatsapp/types'
import { ProcessedMessage } from '../../domain/types'

export interface IMessageWriterService {
  processMessage(
    msg: BaileysMessage,
    sock: WASocket | null
  ): Promise<ProcessedMessage | ProtocolResult | null>

  revokeMessageInDb(messageId: string): Promise<void>

  editMessageInDb(
    messageId: string,
    textContent: string | null,
    editedContent: Record<string, unknown> | null
  ): Promise<void>

  bulkPersistMessages(msgs: BaileysMessage[]): Promise<void>

  processReaction(
    reactionUpdate: BaileysReactionUpdate,
    sock: WASocket | null
  ): Promise<void>
}
