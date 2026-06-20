import { Message, Identity } from '../../domain/types'

export interface IMessageQueryRepository {
  findExistingIds(ids: string[]): Promise<Set<string>>
  
  findMessagesByIds(ids: string[]): Promise<Message[]>
  
  findMessageById(id: string): Promise<Message | null>
  
  findMessageWithSender(id: string): Promise<(Message & { sender: Identity | null }) | null>
  
  findChatMessagesWithSender(
    chatJid: string,
    skip: number,
    take: number
  ): Promise<Array<Message & { sender: Identity | null }>>
  
  findMessageTypeAndContent(id: string): Promise<{ messageType: string; textContent: string | null } | null>
  
  findMessagesByChat(chatJid: string, limit: number): Promise<Message[]>
  
  findLastMessage(chatJid: string): Promise<any>
  
  findMessagesByIdsWithChatAndSender(ids: string[]): Promise<any[]>
  
  findMessageIdsOnly(where: any): Promise<string[]>
  
  findMessagesWithChatAndSender(where: any, take?: number): Promise<any[]>

  findMessagesWithTextContent(): Promise<Array<{ id: string; textContent: string | null }>>
}
