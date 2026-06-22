import { IContactMutationService } from '../contacts/IContactService'
import { IChatRepository } from '../chats/IChatRepository'
import { ICommunityRepository } from '../chats/ICommunityRepository'
import { cleanJid } from '../../utils/jidUtils'
import { parseBaileysTimestamp } from '../../utils/messageUtils'

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

      const hasCommunityData =
        c.isCommunity !== undefined ||
        c.isParentGroup !== undefined ||
        c.isAnnounce !== undefined ||
        c.isCommunityAnnounce !== undefined ||
        c.isDefaultSubgroup !== undefined ||
        c.linkedParentJid !== undefined ||
        c.linkedParent !== undefined ||
        c.parentGroupId !== undefined

      const tsRaw = c.conversationTimestamp ?? c.timestamp
      const timestamp =
        tsRaw !== undefined && tsRaw !== null ? parseBaileysTimestamp(tsRaw) : BigInt(0)

      const updateData: {
        timestamp?: bigint
        isArchived?: boolean
        name?: string | null
        muteExpiration?: bigint
        type?: string
        communityId?: number | null
        unreadCount?: number
      } = {}
      if (timestamp !== BigInt(0)) updateData.timestamp = timestamp
      if ('archived' in c || 'isArchived' in c) {
        updateData.isArchived = c.archived === true || c.isArchived === true
      }
      if (c.name !== undefined) updateData.name = c.name

      const rawMute = c.muteExpiration !== undefined ? c.muteExpiration : c.muteEndTime
      if (rawMute !== undefined && rawMute !== null) {
        const muteVal = parseBaileysTimestamp(rawMute)
        const muteSec = muteVal > 10000000000n ? muteVal / 1000n : muteVal
        updateData.muteExpiration = muteSec
        console.log(`[SyncChatsHandler] Chat ${jid} mute: rawMute=${rawMute}, muteSec=${muteSec}`)
      }

      if (hasCommunityData) {
        updateData.communityId = await this.handleCommunityClassification(c, jid, updateData)
      }

      if (typeof c.unreadCount === 'number') {
        updateData.unreadCount = c.unreadCount
      }

      await this.chatRepository.upsertChat(jid, updateData)

      processedChats.add(jid)

      // Extract PN ↔ LID mappings from group participants
      await this.processParticipants(c)
    }

    return chats.length
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

  private async handleCommunityClassification(
    c: RawChat,
    jid: string,
    updateData: { type?: string }
  ): Promise<number | null> {
    const isCommunity = c.isCommunity === true || c.isParentGroup === true
    const isAnnounce = c.isCommunityAnnounce === true || c.isDefaultSubgroup === true
    const linkedParentJid = c.linkedParentJid ?? c.linkedParent ?? c.parentGroupId

    let type = 'DM'
    if (jid.endsWith('@g.us')) {
      if (isCommunity) type = 'COMMUNITY'
      else if (isAnnounce) type = 'ANNOUNCE'
      else if (linkedParentJid) type = 'SUBGROUP'
      else type = 'GROUP'
    }
    updateData.type = type

    let communityId: number | null = null
    const rootJid = isCommunity ? jid : linkedParentJid ? cleanJid(String(linkedParentJid)) : null
    if (rootJid) {
      const comm = await this.communityRepository.upsertCommunity(rootJid, isCommunity ? (c.name ?? null) : null)
      communityId = comm.id

      if (isAnnounce) {
        await this.communityRepository
          .updateCommunityAnnounceJid(communityId, jid)
          .catch((err: unknown) => {
            console.error('[SyncChatsHandler] community announceJid update failed:', err)
          })
      }
    }
    return communityId
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
