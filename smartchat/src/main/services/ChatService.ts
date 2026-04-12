import { prisma } from '../auth'

export class ChatService {
  /**
   * Handles chats.upsert and chats.update.
   */
  async upsertChat(jid: string, update: any): Promise<void> {
    const data: Record<string, any> = {}

    if (typeof update.unreadCount === 'number') {
      data.unreadCount = update.unreadCount
    }
    if (typeof update.pinned === 'number') {
      data.pinned = update.pinned
    }
    if (update.muteExpiration !== undefined) {
      const mute = update.muteExpiration
      data.muteExpiration = BigInt(typeof mute === 'number' ? mute : 0)
    }
    if (update.archived !== undefined) {
      data.isArchived = update.archived === true
    }

    // Community Metadata Normalization
    const isComm = update.isCommunity === true || update.isParentGroup === true
    const isAnn = update.isAnnounce === true || update.isCommunityAnnounce === true || update.isDefaultSubgroup === true
    const parent = update.linkedParentJid || update.linkedParent || update.parentGroupId

    if (update.isCommunity !== undefined || update.isParentGroup !== undefined) data.isCommunity = isComm
    if (update.isAnnounce !== undefined || update.isCommunityAnnounce !== undefined || update.isDefaultSubgroup !== undefined) data.isAnnounce = isAnn
    if (parent !== undefined) data.linkedParentJid = parent

    const ts = update.conversationTimestamp ?? update.timestamp
    if (ts) {
      data.timestamp = BigInt(
        typeof ts === 'object' && ts !== null && 'low' in ts ? ts.low : ts
      )
    }

    if (Object.keys(data).length > 0) {
      await prisma.chat.upsert({
        where: { jid },
        update: data,
        create: { jid, ...data }
      })
    }
  }

  /**
   * Clears the unread count for a chat.
   */
  async markRead(jid: string): Promise<boolean> {
    try {
      await prisma.chat.update({
        where: { jid },
        data: { unreadCount: 0 }
      })
      return true
    } catch (err) {
      console.error(`[ChatService] Failed to mark chat ${jid} as read:`, err)
      return false
    }
  }

  /**
   * Increments the unread count for a chat.
   */
  async incrementUnread(jid: string, timestamp: bigint): Promise<void> {
    await prisma.chat.upsert({
      where: { jid },
      update: { unreadCount: { increment: 1 }, timestamp },
      create: { jid, unreadCount: 1, timestamp }
    })
  }

  /**
   * Simple timestamp update.
   */
  async updateTimestamp(jid: string, timestamp: bigint): Promise<void> {
    await prisma.chat.upsert({
      where: { jid },
      update: { timestamp },
      create: { jid, unreadCount: 0, timestamp }
    })
  }
}

export const chatService = new ChatService()
