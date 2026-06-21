import { MessageQueryFilter, MessageWithChatAndSender, LastMessageWithSender } from '../../domain/types'

export interface IMessageSearchRepository {
  findLastMessage(chatJid: string): Promise<LastMessageWithSender | null>
  findMessagesByIdsWithChatAndSender(ids: string[]): Promise<MessageWithChatAndSender[]>
  findMessageIdsOnly(filter: MessageQueryFilter): Promise<string[]>
  findMessagesWithChatAndSender(filter: MessageQueryFilter, take?: number): Promise<MessageWithChatAndSender[]>
}
