import { cleanJid, parseCommunityMetadata } from '../../utils'
import { ContactService } from '../contacts/ContactService'
import { ChatListItem, ChatUpdatePayload, WASocket } from '../../types'
import { IChatRepository } from './IChatRepository'
import { ChatListEnricher } from './ChatListEnricher'

export class ChatService {
  constructor(
    private readonly chatRepository: IChatRepository,
    private readonly contactService: ContactService,
    private readonly chatListEnricher: ChatListEnricher
  ) {}

  /**
   * Handles chats.upsert and chats.update.
   */
  async upsertChat(jid: string, update: ChatUpdatePayload): Promise<void> {
    const cleanedJid = cleanJid(jid)
    if (!cleanedJid) return

    const data: {
      unreadCount?: number
      pinned?: number
      muteExpiration?: bigint
      isArchived?: boolean
      name?: string | null
      profilePictureUrl?: string | null
      timestamp?: bigint
      type?: 'DM' | 'GROUP' | 'COMMUNITY' | 'SUBGROUP' | 'ANNOUNCE'
      communityId?: number | null
    } = {}

    if (typeof update.unreadCount === 'number') {
      data.unreadCount = update.unreadCount
    }
    if (update.pinned !== undefined) {
      data.pinned = update.pinned === null ? 0 : Number(update.pinned)
    }
    if (update.muteExpiration !== undefined) {
      const mute = update.muteExpiration
      data.muteExpiration = typeof mute === 'bigint' ? mute : BigInt(typeof mute === 'number' ? mute : 0)
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
        typeof ts === 'object' && ts !== null && 'low' in ts 
          ? (ts as unknown as { low: number }).low 
          : (ts as unknown as number | bigint)
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
          await this.contactService.linkLidAndPn(cleanOwner, cleanOwnerPn, 'group.metadata.owner').catch((err) => {
            console.error('[ChatService] Failed to link owner LID and PN:', err)
          })
        }
      }
      if (update.descOwner && update.descOwnerPn) {
        const cleanDescOwner = cleanJid(update.descOwner)
        const cleanDescOwnerPn = cleanJid(update.descOwnerPn)
        if (cleanDescOwner.includes('@lid') && cleanDescOwnerPn.includes('@s.whatsapp.net')) {
          await this.contactService.linkLidAndPn(cleanDescOwner, cleanDescOwnerPn, 'group.metadata.descOwner').catch((err) => {
            console.error('[ChatService] Failed to link descOwner LID and PN:', err)
          })
        }
      }

      if (rootJid) {
        // Ensure Community exists
        const comm = await this.chatRepository.upsertCommunity(rootJid, commInfo.isCommunity ? (chatName ?? null) : null)
        communityId = comm.id
        
        // Update announce channel if known
        if (commInfo.isAnnounce && rootJid) {
          await this.chatRepository.updateCommunityAnnounceJid(communityId, cleanedJid)
        }
      }
      data.communityId = communityId
    }

    // Always upsert the chat to guarantee it exists in the database
    await this.chatRepository.upsertChat(cleanedJid, data)
  }

  /**
   * Clears the unread count for a chat.
   */
  async markRead(jid: string): Promise<boolean> {
    const cleanedJid = cleanJid(jid)
    try {
      await this.chatRepository.updateChatUnreadCount(cleanedJid, 0)
      return true
    } catch (err) {
      console.error(`[ChatService] Failed to mark chat ${cleanedJid} as read:`, err)
      return false
    }
  }

  /**
   * Checks if a chat is currently muted.
   */
  async isChatMuted(jid: string): Promise<boolean> {
    const cleanedJid = cleanJid(jid)
    if (!cleanedJid) return false
    try {
      const chat = await this.chatRepository.findChatMuteExpiration(cleanedJid)
      if (!chat || !chat.muteExpiration) return false
      const expiration = Number(chat.muteExpiration)
      return expiration === -1 || expiration * 1000 > Date.now()
    } catch (err) {
      console.error(`[ChatService] Failed to check if chat ${cleanedJid} is muted:`, err)
      return false
    }
  }

  /**
   * Increments the unread count for a chat.
   */
  async incrementUnread(jid: string, timestamp: bigint): Promise<void> {
    const cleanedJid = cleanJid(jid)
    await this.chatRepository.incrementUnread(cleanedJid, timestamp)
  }

  /**
   * Simple timestamp update.
   */
  async updateTimestamp(jid: string, timestamp: bigint): Promise<void> {
    const cleanedJid = cleanJid(jid)
    await this.chatRepository.updateTimestamp(cleanedJid, timestamp)
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
        await this.contactService.linkLidAndPn(p.lid, p.pn, 'group.participant').catch((err) => {
          console.error('[ChatService] Failed to link group participant LID and PN:', err)
        })
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
        await this.contactService.upsertContact({ id: contactId, ...(p.lid && p.pn ? { lid: p.lid } : {}) }).catch((err) => {
          console.error('[ChatService] Failed to upsert group participant contact:', err)
        })
        identityId = p.pn
          ? await this.contactService.getIdentityIdByJid(p.pn)
          : await this.contactService.getIdentityIdByJid(p.id)
      }

      if (identityId) {
        const role = p.admin === 'superadmin' ? 'SUPERADMIN' : (p.admin === 'admin' ? 'ADMIN' : 'MEMBER')
        await this.chatRepository.upsertChatMember(cleanedChatJid, identityId, role).catch((err) => {
          console.error('[ChatService] Failed to upsert chat member:', err)
        })
      }
    }
  }

  /**
   * Retrieves the chat list (paginated).
   */
  async getChatList(page: number = 1, pageSize: number = 50): Promise<ChatListItem[]> {
    return this.chatListEnricher.getChatList(page, pageSize)
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
      const participants = metadata.participants as Array<{ id: string; admin?: 'admin' | 'superadmin' | null }>
      const jids = participants.map(p => p.id)
      const nameMap = await this.contactService.batchResolveNames(jids, sock)
      return participants.map(p => ({
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
