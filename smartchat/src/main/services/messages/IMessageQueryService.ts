import { DBMessageWithSender } from '../../domain/db.types'
import { EnrichedMessage } from '../../ipc/message.types'

export interface IMessageQueryService {
  getChatMessages(
    jid: string,
    page?: number,
    pageSize?: number,
    sock?: unknown | null,
    resolveLid?: boolean,
    includeReactions?: boolean
  ): Promise<EnrichedMessage[]>

  enrichMessage(
    msg: DBMessageWithSender,
    sock: unknown | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage>
}

