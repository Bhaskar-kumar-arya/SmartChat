import { MessageQueryFilter } from '../../domain/filters'
import { MessageWithChatAndSender, LastMessageWithSender } from '../../domain/projections'

export interface IMessageSearchRepository {
  findLastMessage(chatJid: string): Promise<LastMessageWithSender | null>
  findMessagesByIdsWithChatAndSender(ids: string[]): Promise<MessageWithChatAndSender[]>
  findMessageIdsOnly(filter: MessageQueryFilter): Promise<string[]>
  findMessagesWithChatAndSender(filter: MessageQueryFilter, take?: number): Promise<MessageWithChatAndSender[]>
}
