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

  /**
   * Returns the key of the oldest message stored locally for `jid`, used to
   * anchor an on-demand history fetch from WhatsApp. Null if the chat has no
   * stored messages.
   */
  getOldestMessageKey(
    jid: string
  ): Promise<{ id: string; fromMe: boolean; timestampMs: number } | null>

  enrichMessage(
    msg: DBMessageWithSender,
    sock: unknown | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage>

  enrichSingleMessage(
    msg: DBMessageWithSender,
    sock: unknown | null
  ): Promise<EnrichedMessage>
}
