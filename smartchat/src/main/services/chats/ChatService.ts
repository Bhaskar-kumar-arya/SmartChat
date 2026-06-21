import { cleanJid, parseCommunityMetadata } from '../../utils'
import { IContactService } from '../contacts/IContactService'
import { ChatUpdatePayload, SocketAccessor } from '../whatsapp/types'
import { ChatListEntry } from '../../domain/chatList.types'
import { IChatRepository } from './IChatRepository'
import { ICommunityRepository } from './ICommunityRepository'
import { ChatListEnricher } from './ChatListEnricher'
import { IChatService } from './IChatService'
import { IGroupMembershipService } from './IGroupMembershipService'

export class ChatService implements IChatService {
  constructor(
    private readonly chatRepository: IChatRepository,
    private readonly communityRepository: ICommunityRepository,
    private readonly contactService: IContactService,
    private readonly groupMembershipService: IGroupMembershipService,
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
      await this.groupMembershipService.linkGroupMetadataOwners(update)

      if (rootJid) {
        // Ensure Community exists
        const comm = await this.communityRepository.upsertCommunity(rootJid, commInfo.isCommunity ? (chatName ?? null) : null)
        communityId = comm.id
        
        // Update announce channel if known
        if (commInfo.isAnnounce && rootJid) {
          await this.communityRepository.updateCommunityAnnounceJid(communityId, cleanedJid)
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
   * Retrieves the chat list (paginated).
   */
  async getChatList(page: number = 1, pageSize: number = 50): Promise<ChatListEntry[]> {
    return this.chatListEnricher.getChatList(page, pageSize) as unknown as Promise<ChatListEntry[]>
  }

  /**
   * Fetches the participants of a group.
   */
  async getGroupParticipants(
    jid: string,
    sock: SocketAccessor
  ): Promise<Array<{ jid: string; name: string; isAdmin: boolean; isMe: boolean }>> {
    const s = sock()
    if (!s || !jid.endsWith('@g.us')) return []
    try {
      const metadata = await s.groupMetadata(jid)
      const participants = metadata.participants as Array<{ id: string; admin?: 'admin' | 'superadmin' | null }>
      const jids = participants.map(p => p.id)
      const nameMap = await this.contactService.batchResolveNames(jids, s)
      return participants.map(p => ({
        jid: p.id,
        name: nameMap.get(p.id) || p.id.split('@')[0],
        isAdmin: !!p.admin,
        isMe: !!s.user && p.id === s.user.id
      }))
    } catch (err) {
      return []
    }
  }
}
