import { prisma } from '../../auth'
import { cleanJid } from '../../utils'

export class ChatService {
  /**
   * Handles chats.upsert and chats.update.
   */
  async upsertChat(jid: string, update: any): Promise<void> {
    const cleanedJid = cleanJid(jid)
    if (!cleanedJid) return

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
      if (cleanedJid.endsWith('@g.us')) {
        if (isComm) type = 'COMMUNITY'
        else if (isAnn) type = 'ANNOUNCE'
        else if (parent) type = 'SUBGROUP'
        else type = 'GROUP'
      }
      data.type = type
      
      // Determine the root community JID if applicable
      const rootJid = isComm ? cleanedJid : (parent ? cleanJid(parent) : null)
      let communityId: number | null = null
      
      const { contactService } = await import('../contacts/ContactService')

      // Link owner LIDs to Phone Numbers if provided in metadata
      if (update.owner && update.ownerPn) {
        const cleanOwner = cleanJid(update.owner)
        const cleanOwnerPn = cleanJid(update.ownerPn)
        if (cleanOwner.includes('@lid') && cleanOwnerPn.includes('@s.whatsapp.net')) {
          await contactService.linkLidAndPn(cleanOwner, cleanOwnerPn, 'group.metadata.owner').catch(() => {})
        }
      }
      if (update.descOwner && update.descOwnerPn) {
        const cleanDescOwner = cleanJid(update.descOwner)
        const cleanDescOwnerPn = cleanJid(update.descOwnerPn)
        if (cleanDescOwner.includes('@lid') && cleanDescOwnerPn.includes('@s.whatsapp.net')) {
          await contactService.linkLidAndPn(cleanDescOwner, cleanDescOwnerPn, 'group.metadata.descOwner').catch(() => {})
        }
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
            data: { announceJid: cleanedJid }
          })
        }
      }
      data.communityId = communityId
    }

    if (Object.keys(data).length > 0) {
      const createType = data.type || (cleanedJid.endsWith('@g.us') ? 'GROUP' : 'DM')
      await prisma.chat.upsert({
        where: { jid: cleanedJid },
        update: data,
        create: { 
          jid: cleanedJid, 
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
    const cleanedJid = cleanJid(jid)
    try {
      await prisma.chat.update({
        where: { jid: cleanedJid },
        data: { unreadCount: 0 }
      })
      return true
    } catch (err) {
      console.error(`[ChatService] Failed to mark chat ${cleanedJid} as read:`, err)
      return false
    }
  }

  /**
   * Increments the unread count for a chat.
   */
  async incrementUnread(jid: string, timestamp: bigint): Promise<void> {
    const cleanedJid = cleanJid(jid)
    const type = cleanedJid.endsWith('@g.us') ? 'GROUP' : 'DM'
    await prisma.chat.upsert({
      where: { jid: cleanedJid },
      update: { unreadCount: { increment: 1 }, timestamp },
      create: { jid: cleanedJid, type, unreadCount: 1, timestamp }
    })
  }

  /**
   * Simple timestamp update.
   */
  async updateTimestamp(jid: string, timestamp: bigint): Promise<void> {
    const cleanedJid = cleanJid(jid)
    const type = cleanedJid.endsWith('@g.us') ? 'GROUP' : 'DM'
    await prisma.chat.upsert({
      where: { jid: cleanedJid },
      update: { timestamp },
      create: { jid: cleanedJid, type, unreadCount: 0, timestamp }
    })
  }

  /**
   * Syncs group participants into the ChatMember table.
   *
   * Participant objects from groupFetchAllParticipating / groups.update carry:
   *   { id: "<LID>@lid", phoneNumber: "<phone>@s.whatsapp.net", admin: "admin"|null }
   */
  async syncGroupMembers(chatJid: string, participants: any[]): Promise<void> {
    const cleanedChatJid = cleanJid(chatJid)
    const { contactService } = await import('../contacts/ContactService')
    
    // Pre-parse and normalize participant JIDs
    const parsedParticipants = participants
      .map(p => {
        if (!p.id) return null
        const rawId = cleanJid(p.id)
        const lid = rawId.endsWith('@lid') ? rawId : (p.lid ? cleanJid(p.lid) : null)
        const pn = p.phoneNumber ? cleanJid(p.phoneNumber) : null
        return {
          id: rawId,
          lid,
          pn,
          admin: p.admin
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)

    if (parsedParticipants.length === 0) return

    // Batched pre-fetch of all identity IDs for clean JIDs
    const allQueryJids: string[] = []
    for (const p of parsedParticipants) {
      if (p.pn) allQueryJids.push(p.pn)
      if (p.lid) allQueryJids.push(p.lid)
      allQueryJids.push(p.id)
    }
    await contactService.batchGetIdentityIds(allQueryJids)

    let count = 0
    for (const p of parsedParticipants) {
      if (++count % 5 === 0) {
        await new Promise(r => setImmediate(r))
      }

      // 1. If we have both LID and phone number, link them.
      if (p.lid && p.pn) {
        await contactService.linkLidAndPn(p.lid, p.pn, 'group.participant').catch(() => {})
      }

      // 2. Look up identity (pre-fetched or cached)
      let identityId = p.pn
        ? await contactService.getIdentityIdByJid(p.pn)
        : null
      if (!identityId && p.lid) {
        identityId = await contactService.getIdentityIdByJid(p.lid)
      }
      if (!identityId) {
        identityId = await contactService.getIdentityIdByJid(p.id)
      }

      // 3. Still not found — create a minimal contact
      if (!identityId) {
        const contactId = p.pn ?? p.lid ?? p.id
        await contactService.upsertContact({ id: contactId, ...(p.lid && p.pn ? { lid: p.lid } : {}) }).catch(() => {})
        identityId = p.pn
          ? await contactService.getIdentityIdByJid(p.pn)
          : await contactService.getIdentityIdByJid(p.id)
      }

      if (identityId) {
        const role = p.admin === 'superadmin' ? 'SUPERADMIN' : (p.admin === 'admin' ? 'ADMIN' : 'MEMBER')
        await prisma.chatMember.upsert({
          where: { chatJid_identityId: { chatJid: cleanedChatJid, identityId } },
          update: { role },
          create: { chatJid: cleanedChatJid, identityId, role }
        }).catch(() => {})
      }
    }
  }
}

export const chatService = new ChatService()
