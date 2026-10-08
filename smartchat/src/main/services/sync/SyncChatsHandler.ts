import { IContactMutationService } from '../contacts/IContactService'
import { IChatRepository } from '../chats/IChatRepository'
import { ICommunityRepository } from '../chats/ICommunityRepository'
import { cleanJid } from '../../utils/jidUtils'
import { normalizeChatUpdate } from '../chats/ChatUpdateNormalizer'
import type { ChatCommunityInfo } from '../chats/ChatUpdateNormalizer'
import { createLogger } from '../../utils/logger'

const log = createLogger('SyncChatsHandler')

export interface RawChatParticipant {
  userJid?: string
  id?: string
  lid?: string
  phoneNumberJid?: string
  phoneNumber?: string
}

export interface RawChat {
  id?: unknown
  accountLid?: string
  isCommunity?: boolean
  isParentGroup?: boolean
  isAnnounce?: boolean
  isCommunityAnnounce?: boolean
  isDefaultSubgroup?: boolean
  linkedParentJid?: string
  linkedParent?: string
  parentGroupId?: string
  name?: string
  muteExpiration?: number | bigint
  muteEndTime?: number | bigint
  conversationTimestamp?: unknown
  timestamp?: unknown
  archived?: boolean
  isArchived?: boolean
  unreadCount?: number
  participant?: RawChatParticipant[]
  [key: string]: unknown
}

/**
 * SyncChatsHandler — Single Responsibility: process all chat-related data
 * during a history sync chunk.
 *
 * Responsibilities:
 *  1. Classify chat types (DM, GROUP, COMMUNITY, ANNOUNCE, SUBGROUP).
 *  2. Handle community metadata upserts.
 *  3. Apply mute/archive settings.
 *  4. Extract and register participant LID ↔ PN mappings.
 */
export class SyncChatsHandler {
  constructor(
    private readonly chatRepository: IChatRepository,
    private readonly communityRepository: ICommunityRepository,
    private readonly contactService: IContactMutationService
  ) {}

  /**
   * Processes all chats from the sync payload, upserting each into the database.
   * Also populates `processedChats` set so downstream message sync can skip chat creation.
   *
   * @param chats         Raw chat objects from the history sync payload.
   * @param processedChats Mutable Set of already-known chat JIDs (populated during this call).
   * @returns The number of chats processed.
   */
  async processChats(chats: RawChat[], processedChats: Set<string>): Promise<number> {
    if (!chats || chats.length === 0) return 0

    let count = 0
    for (const c of chats) {
      if (!c.id) continue
      if (++count % 50 === 0) {
        await new Promise(r => setImmediate(r))
      }

      const jid = cleanJid(String(c.id))

      // Register any accountLid ↔ JID mapping immediately
      await this.linkAccountLid(c, jid)

      const { data: updateData, community } = normalizeChatUpdate(jid, c, 'historySync')
      if (updateData.muteExpiration !== undefined) {
        log.debug(`Chat ${jid} mute: muteSec=${updateData.muteExpiration}`)
      }

      if (community) {
        updateData.communityId = await this.resolveCommunityId(c, jid, community)
      }

      await this.chatRepository.upsertChat(jid, updateData)

      processedChats.add(jid)

      // Extract PN ↔ LID mappings from group participants
      await this.processParticipants(c)
    }

    // `count` was only incremented for entries that had an `.id` and were actually
    // upserted — id-less entries `continue` before the increment. (P2-S4-03)
    return count
  }

  private async linkAccountLid(c: RawChat, jid: string): Promise<void> {
    if (c.accountLid && jid && !jid.endsWith('@lid') && jid.includes('@s.whatsapp.net')) {
      await this.contactService
        .linkLidAndPn(cleanJid(c.accountLid), jid, 'history.sync.chat.accountLid')
        .catch((err: unknown) => {
          console.error('[SyncChatsHandler] linkLidAndPn (chat accountLid) failed:', err)
        })
    }
  }

  private async resolveCommunityId(
    c: RawChat,
    jid: string,
    community: ChatCommunityInfo
  ): Promise<number | null> {
    if (!community.rootJid) return null
    const comm = await this.communityRepository.upsertCommunity(
      community.rootJid,
      community.isCommunity ? (c.name ?? null) : null
    )
    if (community.isAnnounce) {
      await this.communityRepository
        .updateCommunityAnnounceJid(comm.id, jid)
        .catch((err: unknown) => {
          console.error('[SyncChatsHandler] community announceJid update failed:', err)
        })
    }
    return comm.id
  }

  private async processParticipants(c: RawChat): Promise<void> {
    if (c.participant && Array.isArray(c.participant)) {
      for (const p of c.participant) {
        const lid = p.userJid ?? p.id ?? p.lid
        const pn = p.phoneNumberJid ?? p.phoneNumber
        if (lid && pn) {
          const cleanLid = cleanJid(String(lid))
          const cleanPn = cleanJid(String(pn))
          if (cleanLid.includes('@lid') && cleanPn.includes('@s.whatsapp.net')) {
            await this.contactService
              .linkLidAndPn(cleanLid, cleanPn, 'history.sync.participant')
              .catch((err: unknown) => {
                console.error('[SyncChatsHandler] participant linkLidAndPn failed:', err)
              })
          }
        }
      }
    }
  }
}
