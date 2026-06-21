import { PrismaClient, Chat } from '@prisma/client'
import { IChatRepository, ChatUpsertData, ChatWithCommunity } from './IChatRepository'

/**
 * ChatRepository — Encapsulates database operations for the Chat table.
 */
export class ChatRepository implements IChatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find a single chat row.
   */
  async findChatByJid(jid: string): Promise<Chat | null> {
    return this.prisma.chat.findUnique({
      where: { jid }
    })
  }

  /**
   * Batch-find multiple chat rows.
   */
  async findChatsByJids(jids: string[]): Promise<Chat[]> {
    if (jids.length === 0) return []
    return this.prisma.chat.findMany({
      where: { jid: { in: jids } }
    })
  }

  /**
   * Fetch chats sorted by pinned status and timestamp.
   */
  async findChatsPaginated(skip: number, take: number): Promise<ChatWithCommunity[]> {
    const chats = await this.prisma.chat.findMany({
      orderBy: [
        { pinned: 'desc' },
        { timestamp: 'desc' }
      ],
      select: {
        jid: true,
        name: true,
        unreadCount: true,
        timestamp: true,
        pinned: true,
        muteExpiration: true,
        type: true,
        communityId: true,
        community: {
          select: {
            jid: true,
            name: true
          }
        },
        profilePictureUrl: true,
        isArchived: true
      },
      skip,
      take
    })
    return chats as ChatWithCommunity[]
  }

  /**
   * Fetch multiple chats with community details.
   */
  async findChatsByJidsWithCommunity(jids: string[]): Promise<ChatWithCommunity[]> {
    if (jids.length === 0) return []
    const chats = await this.prisma.chat.findMany({
      where: { jid: { in: jids } },
      select: {
        jid: true,
        name: true,
        unreadCount: true,
        timestamp: true,
        pinned: true,
        muteExpiration: true,
        type: true,
        communityId: true,
        community: {
          select: {
            jid: true,
            name: true
          }
        },
        profilePictureUrl: true,
        isArchived: true
      }
    })
    return chats as ChatWithCommunity[]
  }

  /**
   * Fetch all chats belonging to specified communities, or are community roots themselves.
   */
  async findChatsByCommunityJids(communityJids: string[]): Promise<ChatWithCommunity[]> {
    if (communityJids.length === 0) return []
    const chats = await this.prisma.chat.findMany({
      where: {
        OR: [
          { community: { jid: { in: communityJids } } },
          { jid: { in: communityJids } }
        ]
      },
      select: {
        jid: true,
        name: true,
        unreadCount: true,
        timestamp: true,
        pinned: true,
        muteExpiration: true,
        type: true,
        communityId: true,
        community: {
          select: {
            jid: true,
            name: true
          }
        },
        profilePictureUrl: true,
        isArchived: true
      }
    })
    return chats as ChatWithCommunity[]
  }

  /**
   * Upsert a chat record.
   */
  async upsertChat(jid: string, data: ChatUpsertData): Promise<Chat> {
    const createType = data.type || (jid.endsWith('@g.us') ? 'GROUP' : 'DM')
    return this.prisma.chat.upsert({
      where: { jid },
      update: data,
      create: {
        jid,
        type: createType,
        unreadCount: data.unreadCount ?? 0,
        timestamp: data.timestamp ?? 0n,
        pinned: data.pinned ?? 0,
        muteExpiration: data.muteExpiration ?? 0n,
        isArchived: data.isArchived ?? false,
        name: data.name ?? null,
        communityId: data.communityId ?? null,
        profilePictureUrl: data.profilePictureUrl ?? null
      }
    })
  }

  /**
   * Update a chat's unread count.
   */
  async updateChatUnreadCount(jid: string, count: number): Promise<Chat> {
    return this.prisma.chat.update({
      where: { jid },
      data: { unreadCount: count }
    })
  }

  /**
   * Get only the mute expiration timestamp for a chat.
   */
  async findChatMuteExpiration(jid: string): Promise<{ muteExpiration: bigint } | null> {
    return this.prisma.chat.findUnique({
      where: { jid },
      select: { muteExpiration: true }
    })
  }

  /**
   * Increments the unread count for a chat.
   */
  async incrementUnread(jid: string, timestamp: bigint): Promise<Chat> {
    const type = jid.endsWith('@g.us') ? 'GROUP' : 'DM'
    return this.prisma.chat.upsert({
      where: { jid },
      update: { unreadCount: { increment: 1 }, timestamp },
      create: { jid, type, unreadCount: 1, timestamp }
    })
  }

  /**
   * Simple timestamp update.
   */
  async updateTimestamp(jid: string, timestamp: bigint): Promise<Chat> {
    const type = jid.endsWith('@g.us') ? 'GROUP' : 'DM'
    return this.prisma.chat.upsert({
      where: { jid },
      update: { timestamp },
      create: { jid, type, unreadCount: 0, timestamp }
    })
  }

  /**
   * Fetch chats matching the JIDs list or all chats.
   */
  async findChats(jids?: string[]): Promise<Chat[]> {
    if (jids && jids.length > 0) {
      return this.prisma.chat.findMany({
        where: { jid: { in: jids } }
      })
    }
    return this.prisma.chat.findMany()
  }

  /**
   * Search chats by name or JID.
   */
  async searchChats(query: string, take: number = 20): Promise<Array<{ jid: string; name: string | null; type: string; profilePictureUrl: string | null }>> {
    return this.prisma.chat.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { jid: { contains: query } }
        ]
      },
      select: {
        jid: true,
        name: true,
        type: true,
        profilePictureUrl: true
      },
      take
    })
  }

  /**
   * Fetch only the JID of all chats.
   */
  async findAllChatJids(): Promise<string[]> {
    const chats = await this.prisma.chat.findMany({
      select: { jid: true }
    })
    return chats.map(c => c.jid)
  }

  /**
   * Returns the total number of chat rows in the database.
   */
  async countChats(): Promise<number> {
    return this.prisma.chat.count()
  }

  /**
   * Bulk-create multiple chat rows.
   */
  async bulkCreateChats(chats: Array<{ jid: string; type: string }>): Promise<void> {
    await this.prisma.chat.createMany({
      data: chats.map(c => ({
        jid: c.jid,
        type: c.type,
        unreadCount: 0,
        timestamp: 0n,
        pinned: 0,
        muteExpiration: 0n,
        isArchived: false
      }))
    }).catch((err: unknown) => {
      console.warn('[ChatRepository] Failed to bulk-create chats:', err)
    })
  }
}
