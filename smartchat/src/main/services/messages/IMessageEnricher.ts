import { DBMessageWithSender } from '../../domain/db.types'
import { EnrichedMessage } from '../../ipc/message.types'

export interface IMessageEnricher {
  enrichMessage(
    msg: DBMessageWithSender,
    sock: unknown | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage>
}
