import { PrismaClient } from '@prisma/client'
import { cleanJid, parseCommunityMetadata } from '../../utils'
import { ContactService } from '../contacts/ContactService'
import { ChatListItem, ChatUpdatePayload, WASocket } from '../../types'

export class ChatService {
  constructor(
    private prisma: PrismaClient,
    private contactService: ContactService
  ) {}

  /**
   * Handles chats.upsert and chats.update.
   */
  async upsertChat(jid: string, update: ChatUpdatePayload): Promise<void> {
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
        typeof ts === 'object' && ts !== null && 'low' in ts ? (ts as any).low : (ts as any)
      )
    }

    // Community Metadata Normalization
    const commInfo = parseCommunityMetadata(cleanedJid, update)

    if (commInfo.hasCommunityData) {
      data.type = commInfo.type
      const rootJid = commInfo.rootJid
      let communityId: number | null = null

      // Link owner LIDs to Phone Numbers if provided in metadata
      if (update.owner && update.ownerPn) {
        const cleanOwner = cleanJid(update.owner)
        const cleanOwnerPn = cleanJid(update.ownerPn)
        if (cleanOwner.includes('@lid') && cleanOwnerPn.includes('@s.whatsapp.net')) {
          await this.contactService.linkLidAndPn(cleanOwner, cleanOwnerPn, 'group.metadata.owner').catch(() => {})
        }
      }
      if (update.descOwner && update.descOwnerPn) {
        const cleanDescOwner = cleanJid(update.descOwner)
        const cleanDescOwnerPn = cleanJid(update.descOwnerPn)
        if (cleanDescOwner.includes('@lid') && cleanDescOwnerPn.includes('@s.whatsapp.net')) {
          await this.contactService.linkLidAndPn(cleanDescOwner, cleanDescOwnerPn, 'group.metadata.descOwner').catch(() => {})
        }
      }

      if (rootJid) {
        const updateData: any = {}
        if (commInfo.isCommunity && chatName) updateData.name = chatName

        // Ensure Community exists
        const comm = await this.prisma.community.upsert({
          where: { jid: rootJid },
          update: updateData,
          create: { jid: rootJid, name: commInfo.isCommunity ? chatName : null }
        })
        communityId = comm.id
        
        // Update announce channel if known
        if (commInfo.isAnnounce && rootJid) {
          await this.prisma.community.update({
            where: { id: communityId },
            data: { announceJid: cleanedJid }
          })
        }
      }
      data.communityId = communityId
    }

    if (Object.keys(data).length > 0) {
      const createType = data.type || (cleanedJid.endsWith('@g.us') ? 'GROUP' : 'DM')
      await this.prisma.chat.upsert({
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
      await this.prisma.chat.update({
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
    await this.prisma.chat.upsert({
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
    await this.prisma.chat.upsert({
      where: { jid: cleanedJid },
      update: { timestamp },
      create: { jid: cleanedJid, type, unreadCount: 0, timestamp }
    })
  }

  /**
   * Syncs group participants into the ChatMember table.
   */
  async syncGroupMembers(
    chatJid: string,
    participants: Array<{
      id: string
      admin?: 'admin' | 'superadmin' | null
      lid?: string | null
      phoneNumber?: string | null
    }>
  ): Promise<void> {
    const cleanedChatJid = cleanJid(chatJid)
    
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
    await this.contactService.batchGetIdentityIds(allQueryJids)

    let count = 0
    for (const p of parsedParticipants) {
      if (++count % 5 === 0) {
        await new Promise(r => setImmediate(r))
      }

      // 1. If we have both LID and phone number, link them.
      if (p.lid && p.pn) {
        await this.contactService.linkLidAndPn(p.lid, p.pn, 'group.participant').catch(() => {})
      }

      // 2. Look up identity (pre-fetched or cached)
      let identityId = p.pn
        ? await this.contactService.getIdentityIdByJid(p.pn)
        : null
      if (!identityId && p.lid) {
        identityId = await this.contactService.getIdentityIdByJid(p.lid)
      }
      if (!identityId) {
        identityId = await this.contactService.getIdentityIdByJid(p.id)
      }

      // 3. Still not found — create a minimal contact
      if (!identityId) {
        const contactId = p.pn ?? p.lid ?? p.id
        await this.contactService.upsertContact({ id: contactId, ...(p.lid && p.pn ? { lid: p.lid } : {}) }).catch(() => {})
        identityId = p.pn
          ? await this.contactService.getIdentityIdByJid(p.pn)
          : await this.contactService.getIdentityIdByJid(p.id)
      }

      if (identityId) {
        const role = p.admin === 'superadmin' ? 'SUPERADMIN' : (p.admin === 'admin' ? 'ADMIN' : 'MEMBER')
        await this.prisma.chatMember.upsert({
          where: { chatJid_identityId: { chatJid: cleanedChatJid, identityId } },
          update: { role },
          create: { chatJid: cleanedChatJid, identityId, role }
        }).catch(() => {})
      }
    }
  }

  /**
   * Retrieves the chat list (paginated).
   */
  async getChatList(page: number = 1, pageSize: number = 50): Promise<ChatListItem[]> {
    const skip = (page - 1) * pageSize
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
            jid: true
          }
        },
        profilePictureUrl: true
      },
      skip,
      take: pageSize
    })
    
    // Auto-inject missing root communities so the frontend can properly nest subgroups
    const fetchedJids = new Set(chats.map(c => c.jid))
    const missingCommunityJids = new Set<string>()
    for (const chat of chats) {
      if ((chat.type === 'SUBGROUP' || chat.type === 'ANNOUNCE') && chat.community?.jid) {
        if (!fetchedJids.has(chat.community.jid)) {
          missingCommunityJids.add(chat.community.jid)
        }
      }
    }

    if (missingCommunityJids.size > 0) {
      const missingCommunities = await this.prisma.chat.findMany({
        where: { jid: { in: Array.from(missingCommunityJids) } },
        select: {
          jid: true, name: true, unreadCount: true, timestamp: true,
          pinned: true, muteExpiration: true, type: true, communityId: true,
          community: { select: { jid: true } }, profilePictureUrl: true
        }
      })
      chats.push(...missingCommunities)
    }

    // Fallback if chat.name is missing for a DM: resolve it dynamically
    const enriched = await Promise.all(
      chats.map(async (chat) => {
        let name = chat.name
        if (!name) {
          if (chat.type === 'DM') {
            const identId = await this.contactService.getIdentityIdByJid(chat.jid)
            if (identId) {
              const ident = await this.prisma.identity.findUnique({ where: { id: identId } })
              if (ident) name = ident.displayName || ident.pushName || ident.verifiedName || ident.phoneNumber?.split('@')[0] || null
            }
          }
          if (!name) name = chat.jid.split('@')[0]
        }

        // Fetch the most recent message for preview
        const lastMsg = await this.prisma.message.findFirst({
          where: { chatJid: chat.jid },
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

        const effectiveTimestamp = lastMsg?.timestamp ?? chat.timestamp

        let lastMessageSender: string | null = null
        if (lastMsg) {
          if (lastMsg.fromMe) {
            lastMessageSender = 'You'
          } else {
            lastMessageSender = ContactService.getDisplayName(
              lastMsg.sender,
              lastMsg.participant?.split('@')[0] || 'Someone'
            )
          }
        }

        return {
          jid: chat.jid,
          name,
          unreadCount: chat.unreadCount,
          timestamp: effectiveTimestamp.toString(),
          lastMessage: lastMsg?.messageType === 'stickerMessage' ? 'Sticker' :
                       lastMsg?.messageType === 'lottieStickerMessage' ? 'Sticker' :
                       lastMsg?.messageType === 'imageMessage' ? 'Photo' :
                       lastMsg?.messageType === 'videoMessage' ? 'Video' :
                       lastMsg?.messageType === 'ptvMessage' ? 'Video' :
                       lastMsg?.messageType === 'documentMessage' ? 'Document' :
                       lastMsg?.messageType === 'audioMessage' ? 'Audio' :
                       (lastMsg?.textContent ?? ''),
          // Note: conversation/extendedTextMessage/unknown all fall through to textContent
          lastMessageType: lastMsg?.messageType || null,
          lastMessageTimestamp: effectiveTimestamp.toString(),
          pinned: chat.pinned,
          muteExpiration: chat.muteExpiration.toString(),
          profilePictureUrl: chat.profilePictureUrl,
          isCommunity: chat.type === 'COMMUNITY',
          isAnnounce: chat.type === 'ANNOUNCE',
          linkedParentJid: (chat.type === 'SUBGROUP' || chat.type === 'ANNOUNCE') ? (chat.community?.jid ?? null) : null,
          lastMessageSender,
          lastMessageStatus: lastMsg?.status || null,
          lastMessageFromMe: lastMsg?.fromMe || false,
          lastMessageId: lastMsg?.id || null
        }
      })
    )

    return enriched
  }

  /**
   * Fetches the participants of a group.
   */
  async getGroupParticipants(
    jid: string,
    sock: WASocket | null
  ): Promise<Array<{ jid: string; name: string; isAdmin: boolean; isMe: boolean }>> {
    if (!sock || !jid.endsWith('@g.us')) return []
    try {
      const metadata = await sock.groupMetadata(jid)
      const jids = metadata.participants.map((p: any) => p.id)
      const nameMap = await this.contactService.batchResolveNames(jids, sock)
      return metadata.participants.map((p: any) => ({
        jid: p.id,
        name: nameMap.get(p.id) || p.id.split('@')[0],
        isAdmin: !!p.admin,
        isMe: !!sock.user && p.id === sock.user.id
      }))
    } catch (err) {
      return []
    }
  }
}
