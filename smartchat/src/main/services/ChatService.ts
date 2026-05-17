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
    const hasCommunityData = update.isCommunity !== undefined || 
                             update.isParentGroup !== undefined || 
                             update.isAnnounce !== undefined || 
                             update.isCommunityAnnounce !== undefined || 
                             update.isDefaultSubgroup !== undefined || 
                             update.linkedParentJid !== undefined || 
                             update.linkedParent !== undefined || 
                             update.parentGroupId !== undefined;

    if (hasCommunityData) {
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
      data.type = type
      
      // Determine the root community JID if applicable
      const rootJid = isComm ? jid : (parent || null)
      let communityId: number | null = null
      
      const { contactService } = await import('./ContactService')

      // Link owner LIDs to Phone Numbers if provided in metadata
      if (update.owner && update.ownerPn && update.owner.includes('@lid') && update.ownerPn.includes('@s.whatsapp.net')) {
        await contactService.linkLidAndPn(update.owner, update.ownerPn, 'group.metadata.owner').catch(() => {})
      }
      if (update.descOwner && update.descOwnerPn && update.descOwner.includes('@lid') && update.descOwnerPn.includes('@s.whatsapp.net')) {
        await contactService.linkLidAndPn(update.descOwner, update.descOwnerPn, 'group.metadata.descOwner').catch(() => {})
      }

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
      data.communityId = communityId
    }

    if (Object.keys(data).length > 0) {
      const createType = data.type || (jid.endsWith('@g.us') ? 'GROUP' : 'DM')
      await prisma.chat.upsert({
        where: { jid },
        update: data,
        create: { 
          jid, 
          type: createType, 
          communityId: data.communityId || null, 
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
   *
   * Participant objects from groupFetchAllParticipating / groups.update carry:
   *   { id: "<LID>@lid", phoneNumber: "<phone>@s.whatsapp.net", admin: "admin"|null }
   *
   * We use phoneNumber (when present) as the primary lookup key so we land on an
   * existing identity rather than creating a new LID-only stub. Then we call
   * linkLidAndPn to permanently wire the LID alias to the PN identity, eliminating
   * ghost records.
   */
  async syncGroupMembers(chatJid: string, participants: any[]): Promise<void> {
    const { contactService } = await import('./ContactService')
    let count = 0
    for (const p of participants) {
      if (++count % 20 === 0) await new Promise(r => setImmediate(r))
      if (!p.id) continue

      const lid = p.id.endsWith('@lid') ? p.id : (p.lid ?? null)
      const pn  = p.phoneNumber ?? null   // e.g. "919606910020@s.whatsapp.net"

      // 1. If we have both LID and phone number, link them first.
      //    This resolves the identity properly and prevents ghost stubs.
      if (lid && pn) {
        await contactService.linkLidAndPn(lid, pn, 'group.participant').catch(() => {})
      }

      // 2. Look up identity — prefer PN (more likely to already exist in DB),
      //    fall back to LID.
      let identityId = pn
        ? await contactService.getIdentityIdByJid(pn)
        : null
      if (!identityId && lid) {
        identityId = await contactService.getIdentityIdByJid(lid)
      }

      // 3. Still not found — create a minimal contact.
      //    Use PN as id if available (avoids creating bare LID ghost).
      if (!identityId) {
        const contactId = pn ?? lid ?? p.id
        await contactService.upsertContact({ id: contactId, ...(lid && pn ? { lid } : {}) }).catch(() => {})
        identityId = pn
          ? await contactService.getIdentityIdByJid(pn)
          : await contactService.getIdentityIdByJid(p.id)
      }

      if (identityId) {
        const role = p.admin === 'superadmin' ? 'SUPERADMIN' : (p.admin === 'admin' ? 'ADMIN' : 'MEMBER')
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
