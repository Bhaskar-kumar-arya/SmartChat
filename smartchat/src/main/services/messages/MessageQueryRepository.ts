import { PrismaClient, Message, Prisma } from '@prisma/client'
import { IMessageQueryRepository } from './IMessageQueryRepository'
import { IRawSqlExecutor } from './IRawSqlExecutor'
import { MessageQueryFilter } from '../../domain/filters'
import { MessageWithChatAndSender, LastMessageWithSender } from '../../domain/projections'

export class MessageQueryRepository implements IMessageQueryRepository, IRawSqlExecutor {
  constructor(private readonly prisma: PrismaClient) { }

  private buildPrismaWhere(filter: MessageQueryFilter): Prisma.MessageWhereInput {
    const where: Prisma.MessageWhereInput = {}

    // Enforce textContent not being null as default for normal/vector searches
    if (filter.textContentContains !== undefined || filter.fromDate !== undefined || filter.toDate !== undefined) {
      where.textContent = { not: null }
    }

    if (filter.chatJid) {
      where.chatJid = filter.chatJid
    }
    if (filter.chatJids && filter.chatJids.length > 0) {
      where.chatJid = { in: filter.chatJids }
    }
    if (filter.fromMe !== undefined) {
      where.fromMe = filter.fromMe
    }
    if (filter.fromDate !== undefined || filter.toDate !== undefined) {
      const timestampFilter: Prisma.BigIntFilter = {}
      if (filter.fromDate !== undefined) {
        timestampFilter.gte = filter.fromDate
      }
      if (filter.toDate !== undefined) {
        timestampFilter.lte = filter.toDate
      }
      where.timestamp = timestampFilter
    }
    if (filter.textContentContains) {
      where.textContent = { contains: filter.textContentContains }
    }
    return where
  }

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
  async findLastMessage(chatJid: string): Promise<LastMessageWithSender | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM Message
      WHERE chatJid = ${chatJid}
      ORDER BY timestamp DESC, rowid DESC
      LIMIT 1
    `
    if (rows.length === 0) return null
    return this.prisma.message.findUnique({
      where: { id: rows[0].id },
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
    }) as Promise<LastMessageWithSender | null>
  }

  /**
   * Batch-find multiple messages with chat and sender details.
   */
  async findMessagesByIdsWithChatAndSender(ids: string[]): Promise<MessageWithChatAndSender[]> {
    if (ids.length === 0) return []
    return this.prisma.message.findMany({
      where: { id: { in: ids } },
      include: {
        chat: {
          include: {
            community: true
          }
        },
        sender: true
      }
    }) as Promise<MessageWithChatAndSender[]>
  }

  /**
   * Find only the message IDs matching a query filter.
   */
  async findMessageIdsOnly(filter: MessageQueryFilter): Promise<string[]> {
    const where = this.buildPrismaWhere(filter)
    const rows = await this.prisma.message.findMany({
      where,
      select: { id: true }
    })
    return rows.map(r => r.id)
  }

  /**
   * Find messages matching a query filter, with chat and sender details.
   */
  async findMessagesWithChatAndSender(filter: MessageQueryFilter, take?: number): Promise<MessageWithChatAndSender[]> {
    const where = this.buildPrismaWhere(filter)
    return this.prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take,
      include: {
        chat: {
          include: {
            community: true
          }
        },
        sender: true
      }
    }) as Promise<MessageWithChatAndSender[]>
  }

  async findMessagesByChat(chatJid: string, limit: number): Promise<Message[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM Message
      WHERE chatJid = ${chatJid}
      ORDER BY timestamp DESC, rowid DESC
      LIMIT ${limit}
    `
    if (rows.length === 0) return []
    const ids = rows.map(r => r.id)
    const messages = await this.prisma.message.findMany({
      where: { id: { in: ids } }
    })
    const map = new Map(messages.map(m => [m.id, m]))
    return ids.map(id => map.get(id)).filter(Boolean) as Message[]
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
    }) as Promise<Message[]>
  }

  /**
   * Find a single message by ID (no relations included).
   */
  async findMessageById(id: string): Promise<Message | null> {
    return this.prisma.message.findUnique({ where: { id } }) as Promise<Message | null>
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
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM Message
      WHERE chatJid = ${chatJid}
      ORDER BY timestamp DESC, rowid DESC
      LIMIT ${take} OFFSET ${skip}
    `
    if (rows.length === 0) return []

    const ids = rows.map(r => r.id)
    const messages = await this.prisma.message.findMany({
      where: { id: { in: ids } },
      include: { sender: true }
    })

    const messageMap = new Map(messages.map(m => [m.id, m]))
    return ids
      .map(id => messageMap.get(id))
      .filter(Boolean) as Array<Message & { sender: import('@prisma/client').Identity | null }>
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

  /**
   * Fetches messages anchored at `fromTimestamp`:
   *  - All messages with timestamp >= fromTimestamp (target → newest), ordered asc.
   *  - Up to `lookBehind` messages with timestamp < fromTimestamp (context before target), ordered desc.
   * Returns the combined list sorted chronologically (oldest → newest).
   */
  async findMessagesFromTimestamp(
    chatJid: string,
    fromTimestamp: bigint,
    lookBehind: number
  ): Promise<Array<Message & { sender: import('@prisma/client').Identity | null }>> {
    const [fromTargetRows, beforeRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM Message
        WHERE chatJid = ${chatJid} AND timestamp >= ${fromTimestamp}
        ORDER BY timestamp ASC, rowid ASC
      `,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM Message
        WHERE chatJid = ${chatJid} AND timestamp < ${fromTimestamp}
        ORDER BY timestamp DESC, rowid DESC
        LIMIT ${lookBehind}
      `
    ])

    const combinedIds = [
      ...beforeRows.map(r => r.id).reverse(),
      ...fromTargetRows.map(r => r.id)
    ]

    if (combinedIds.length === 0) return []

    const messages = await this.prisma.message.findMany({
      where: { id: { in: combinedIds } },
      include: { sender: true }
    })

    const messageMap = new Map(messages.map(m => [m.id, m]))
    return combinedIds
      .map(id => messageMap.get(id))
      .filter(Boolean) as Array<Message & { sender: import('@prisma/client').Identity | null }>
  }
}
