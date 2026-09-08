import { MessageQueryFilter } from '../../domain/filters'
import { MessageWithChatAndSender, LastMessageWithSender } from '../../domain/projections'

export interface IMessageSearchRepository {
  findLastMessage(chatJid: string): Promise<LastMessageWithSender | null>
  /**
   * P2-S11-03: batch variant of `findLastMessage` — one query for many chats
   * instead of an N+1 burst from the search box. Chats with no messages are
   * simply absent from the returned map.
   */
  findLastMessagesForChats(chatJids: string[]): Promise<Map<string, LastMessageWithSender>>
  findMessagesByIdsWithChatAndSender(ids: string[]): Promise<MessageWithChatAndSender[]>
  findMessageIdsOnly(filter: MessageQueryFilter): Promise<string[]>
  findMessagesWithChatAndSender(filter: MessageQueryFilter, take?: number): Promise<MessageWithChatAndSender[]>
}
