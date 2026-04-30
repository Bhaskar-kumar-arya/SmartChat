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
    const chatName = update.name || update.subject
    if (chatName !== undefined) {
      data.name = chatName
    }
    if (update.profilePictureUrl !== undefined) {
      data.profilePictureUrl = update.profilePictureUrl
    }

    const ts = update.conversationTimestamp ?? update.timestamp
    if (ts) {
      data.timestamp = BigInt(
        typeof ts === 'object' && ts !== null && 'low' in ts ? ts.low : ts
      )
    }

    // Community Metadata Normalization
    const isComm = update.isCommunity === true || update.isParentGroup === true
    const isAnn = update.isAnnounce === true || update.isCommunityAnnounce === true || update.isDefaultSubgroup === true
    const parent = update.linkedParentJid || update.linkedParent || update.parentGroupId

    let type = 'DM'
    if (jid.endsWith('@g.us')) {
      if (isComm) type = 'COMMUNITY'
      else if (isAnn) type = 'ANNOUNCE'
      else if (parent) type = 'SUBGROUP'
      else type = 'GROUP'
    }
    
    // Determine the root community JID if applicable
    const rootJid = isComm ? jid : (parent || null)
    let communityId: number | null = null

    if (rootJid) {
      const updateData: any = {}
      if (isComm && chatName) updateData.name = chatName

      // Ensure Community exists
      const comm = await prisma.community.upsert({
        where: { jid: rootJid },
        update: updateData,
        create: { jid: rootJid, name: isComm ? chatName : null }
      })
      communityId = comm.id
      
      // Update announce channel if known
      if (isAnn && rootJid) {
        await prisma.community.update({
          where: { id: communityId },
          data: { announceJid: jid }
        })
      }
    }

    if (Object.keys(data).length > 0 || type) {
      await prisma.chat.upsert({
        where: { jid },
        update: { ...data, type, communityId },
        create: { 
          jid, 
          type, 
          communityId, 
          ...data 
        }
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
    const type = jid.endsWith('@g.us') ? 'GROUP' : 'DM'
    await prisma.chat.upsert({
      where: { jid },
      update: { unreadCount: { increment: 1 }, timestamp },
      create: { jid, type, unreadCount: 1, timestamp }
    })
  }

  /**
   * Simple timestamp update.
   */
  async updateTimestamp(jid: string, timestamp: bigint): Promise<void> {
    const type = jid.endsWith('@g.us') ? 'GROUP' : 'DM'
    await prisma.chat.upsert({
      where: { jid },
      update: { timestamp },
      create: { jid, type, unreadCount: 0, timestamp }
    })
  }
  /**
   * Syncs group participants into the ChatMember table.
   */
  async syncGroupMembers(chatJid: string, participants: any[]): Promise<void> {
    const { contactService } = await import('./ContactService')
    let count = 0
    for (const p of participants) {
      if (++count % 20 === 0) await new Promise(r => setImmediate(r)) // Yield to event loop to prevent freezing UI
      if (!p.id) continue;
      
      let identityId = await contactService.getIdentityIdByJid(p.id);
      if (!identityId) {
        await contactService.upsertContact({ id: p.id }).catch(() => {});
        identityId = await contactService.getIdentityIdByJid(p.id);
      }

      if (identityId) {
        const role = p.admin === 'superadmin' ? 'SUPERADMIN' : (p.admin === 'admin' ? 'ADMIN' : 'MEMBER');
        await prisma.chatMember.upsert({
          where: { chatJid_identityId: { chatJid, identityId } },
          update: { role },
          create: { chatJid, identityId, role }
        }).catch(() => {})
      }
    }
  }
}

export const chatService = new ChatService()
