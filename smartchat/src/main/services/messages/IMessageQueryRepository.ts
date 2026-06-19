import { Message } from '@prisma/client'

export interface IMessageQueryRepository {
  findExistingIds(ids: string[]): Promise<Set<string>>
  
  findMessagesByIds(ids: string[]): Promise<Message[]>
  
  findMessageById(id: string): Promise<Message | null>
  
  findMessageWithSender(id: string): Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null>
  
  findChatMessagesWithSender(
    chatJid: string,
    skip: number,
    take: number
  ): Promise<Array<Message & { sender: import('@prisma/client').Identity | null }>>
  
  findMessageTypeAndContent(id: string): Promise<{ messageType: string; textContent: string | null } | null>
  
  findMessagesByChat(chatJid: string, limit: number): Promise<Message[]>
  
  queryMessageIdsBySql(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  
  findLastMessage(chatJid: string): Promise<any>
  
  findMessagesByIdsWithChatAndSender(ids: string[]): Promise<any[]>
  
  findMessageIdsOnly(where: any): Promise<string[]>
  
  findMessagesWithChatAndSender(where: any, take?: number): Promise<any[]>
}
