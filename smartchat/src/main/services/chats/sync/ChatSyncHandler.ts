import { ISyncRepository, SyncChatCreateInput, SyncChatUpdateInput } from '../../sync/ISyncRepository'
import { BaileysGroupMetadata } from '../../whatsapp/types/group.types'
import { cleanJid } from '../../../utils/jidUtils'
import { parseBaileysTimestamp } from '../../../utils/messageUtils'
import { parseCommunityMetadata } from '../../../utils/communityUtils'
import { IChatSyncHandler } from './IChatSyncHandler'

export class ChatSyncHandler implements IChatSyncHandler {
  constructor(private readonly syncRepository: ISyncRepository) {}

  /**
   * Synchronizes chat records for a batch of groups.
   */
  async syncChats(
    groups: Record<string, BaileysGroupMetadata>,
    communityJidToIdMap: Map<string, number>
  ): Promise<void> {
    const groupKeys = Object.keys(groups)
    const allGroupJids = groupKeys.map(cleanJid).filter(Boolean)
    if (allGroupJids.length === 0) return

    const existingChats = await this.syncRepository.findExistingChats(allGroupJids)
    const existingChatsMap = new Map(existingChats.map(c => [c.jid, c]))

    const chatsToInsert: SyncChatCreateInput[] = []
    const chatsToUpdate: SyncChatUpdateInput[] = []

    for (const jid of groupKeys) {
      const raw = groups[jid]
      const cleanedJid = cleanJid(jid)
      const chatName = raw.name || raw.subject || null

      const ts = raw.conversationTimestamp ?? raw.timestamp
      const hasTimestamp = ts !== undefined && ts !== null
      const timestamp = hasTimestamp ? parseBaileysTimestamp(ts) : null
      const isArchived = ('archived' in raw || 'isArchived' in raw) ? (raw.archived === true || raw.isArchived === true) : false

      let type = 'GROUP'
      let communityId: number | null = null

      const commInfo = parseCommunityMetadata(jid, raw)
      if (commInfo.hasCommunityData) {
        type = commInfo.type
        const rootJidVal = commInfo.rootJid
        if (rootJidVal) {
          communityId = communityJidToIdMap.get(rootJidVal) ?? null
        }
      }

      const existing = existingChatsMap.get(cleanedJid)

      if (existing) {
        // Only overwrite fields that the payload actually provides
        const updateObj: {
          type: string
          isArchived: boolean
          communityId: number | null
          name?: string | null
          timestamp?: bigint
          unreadCount?: number
          pinned?: number
          muteExpiration?: bigint
          profilePictureUrl?: string | null
        } = { type, isArchived, communityId }
        
        if (chatName) updateObj.name = chatName
        if (timestamp !== null) updateObj.timestamp = timestamp
        if (typeof raw.unreadCount === 'number') updateObj.unreadCount = raw.unreadCount
        if (typeof raw.pinned === 'number') updateObj.pinned = raw.pinned
        if (raw.muteExpiration !== undefined) {
          const mute = raw.muteExpiration
          updateObj.muteExpiration = typeof mute === 'bigint' ? mute : BigInt(typeof mute === 'number' ? mute : 0)
        }
        if (raw.profilePictureUrl !== undefined) {
          updateObj.profilePictureUrl = raw.profilePictureUrl || null
        }
        
        chatsToUpdate.push({ jid: cleanedJid, ...updateObj })
      } else {
        chatsToInsert.push({
          jid: cleanedJid,
          type,
          unreadCount: typeof raw.unreadCount === 'number' ? raw.unreadCount : 0,
          timestamp: timestamp ?? BigInt(0),
          pinned: typeof raw.pinned === 'number' ? raw.pinned : 0,
          muteExpiration: typeof raw.muteExpiration === 'bigint' 
            ? raw.muteExpiration 
            : BigInt(typeof raw.muteExpiration === 'number' ? raw.muteExpiration : 0),
          isArchived,
          name: chatName,
          communityId,
          profilePictureUrl: raw.profilePictureUrl || null
        })
      }
    }

    if (chatsToInsert.length > 0) {
      await this.syncRepository.bulkCreateChats(chatsToInsert)
    }
    if (chatsToUpdate.length > 0) {
      await this.syncRepository.bulkUpdateChats(chatsToUpdate)
    }
  }
}
