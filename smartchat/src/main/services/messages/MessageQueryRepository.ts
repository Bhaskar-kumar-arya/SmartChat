import { PrismaClient, Message } from '@prisma/client'
import { IMessageQueryRepository } from './IMessageQueryRepository'

export class MessageQueryRepository implements IMessageQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Fetch existing message IDs from a list for pre-existence checks.
   */
  async findExistingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const rows = await this.prisma.message.findMany({
      where: { id: { in: ids } },
      select: { id: true }
    })
    return new Set(rows.map(r => r.id))
  }

  /**
   * Fetch the most recent message for preview in a chat.
   */
  async findLastMessage(chatJid: string): Promise<any> {
    return this.prisma.message.findFirst({
      where: { chatJid },
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        textContent: true,
        messageType: true,
        timestamp: true,
        fromMe: true,
        participant: true,
        status: true,
        sender: {
          select: {
            displayName: true,
            pushName: true,
            verifiedName: true,
            phoneNumber: true
          }
        }
      }
    })
  }

  /**
   * Batch-find multiple messages with chat and sender details.
   */
  async findMessagesByIdsWithChatAndSender(ids: string[]): Promise<any[]> {
    if (ids.length === 0) return []
    return this.prisma.message.findMany({
      where: { id: { in: ids } },
      include: { chat: true, sender: true }
    })
  }

  /**
   * Find only the message IDs matching a where clause.
   */
  async findMessageIdsOnly(where: any): Promise<string[]> {
    const rows = await this.prisma.message.findMany({
      where,
      select: { id: true }
    })
    return rows.map(r => r.id)
  }

  /**
   * Find messages matching a where clause, with chat and sender details.
   */
  async findMessagesWithChatAndSender(where: any, take?: number): Promise<any[]> {
    return this.prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take,
      include: { chat: true, sender: true }
    })
  }

  /**
   * Find messages in a chat, ordered descending by timestamp.
   */
  async findMessagesByChat(chatJid: string, limit: number): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { chatJid },
      orderBy: { timestamp: 'desc' },
      take: limit
    })
  }

  /**
   * Executes a read-only query and returns the matching message ID rows.
   */
  async queryMessageIdsBySql(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params)
  }

  /**
   * Batch-find multiple messages by their IDs.
   */
  async findMessagesByIds(ids: string[]): Promise<Message[]> {
    if (ids.length === 0) return []
    return this.prisma.message.findMany({
      where: { id: { in: ids } }
    })
  }

  /**
   * Find a single message by ID (no relations included).
   */
  async findMessageById(id: string): Promise<Message | null> {
    return this.prisma.message.findUnique({ where: { id } })
  }

  /**
   * Find a single message by ID, including the sender Identity.
   */
  async findMessageWithSender(id: string): Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null> {
    return this.prisma.message.findUnique({
      where: { id },
      include: { sender: true }
    }) as Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null>
  }

  /**
   * Fetch a paginated set of messages for a chat, newest first, with sender included.
   * Used by MessageService.getChatMessages.
   */
  async findChatMessagesWithSender(
    chatJid: string,
    skip: number,
    take: number
  ): Promise<Array<Message & { sender: import('@prisma/client').Identity | null }>> {
    return this.prisma.message.findMany({
      where: { chatJid },
      orderBy: { timestamp: 'desc' },
      skip,
      take,
      include: { sender: true }
    }) as Promise<Array<Message & { sender: import('@prisma/client').Identity | null }>>
  }

  /**
   * Fetch only { messageType, textContent } for a message — used by reaction processing.
   */
  async findMessageTypeAndContent(id: string): Promise<{ messageType: string; textContent: string | null } | null> {
    return this.prisma.message.findUnique({
      where: { id },
      select: { messageType: true, textContent: true }
    })
  }

  async findMessagesWithTextContent(): Promise<Array<{ id: string; textContent: string | null }>> {
    return this.prisma.message.findMany({
      where: { textContent: { not: null } },
      select: { id: true, textContent: true }
    })
  }
}
