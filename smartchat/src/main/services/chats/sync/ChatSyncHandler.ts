import { ISyncRepository, SyncChatCreateInput, SyncChatUpdateInput } from '../../sync/ISyncRepository'
import { BaileysGroupMetadata } from '../../whatsapp/types/group.types'
import { cleanJid } from '../../../utils/jidUtils'
import { normalizeChatUpdate } from '../ChatUpdateNormalizer'
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
      const { data, community } = normalizeChatUpdate(jid, raw, 'groupSync')

      // Unlike the other writers, a community payload without a root leaves communityId untouched.
      let communityId: number | null | undefined = undefined
      if (community?.rootJid) {
        communityId = communityJidToIdMap.get(community.rootJid) ?? null
      }

      const existing = existingChatsMap.get(cleanedJid)

      if (existing) {
        const updateObj: SyncChatUpdateInput = { jid: cleanedJid, ...data }
        if (communityId !== undefined) updateObj.communityId = communityId
        chatsToUpdate.push(updateObj)
      } else {
        chatsToInsert.push({
          jid: cleanedJid,
          type: data.type ?? 'GROUP',
          unreadCount: data.unreadCount ?? 0,
          timestamp: data.timestamp ?? BigInt(0),
          pinned: data.pinned ?? 0,
          muteExpiration: data.muteExpiration ?? BigInt(0),
          isArchived: data.isArchived ?? false,
          name: data.name ?? null,
          communityId: communityId ?? null,
          profilePictureUrl: data.profilePictureUrl ?? null
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
