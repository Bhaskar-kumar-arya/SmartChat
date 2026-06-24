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

  /**
   * Fetches all messages from the target message up to newest, plus
   * `lookBehind` (default 20) messages before it for context.
   * Falls back to getChatMessages page 1 if the target is not found.
   */
  getMessagesAroundId(
    jid: string,
    messageId: string,
    lookBehind?: number,
    sock?: unknown | null
  ): Promise<EnrichedMessage[]>

  enrichMessage(
    msg: DBMessageWithSender,
    sock: unknown | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage>
}
