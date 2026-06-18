import { CommunitySyncHandler } from './sync/CommunitySyncHandler'
import { ChatSyncHandler } from './sync/ChatSyncHandler'
import { MembershipSyncHandler } from './sync/MembershipSyncHandler'

export interface BaileysGroupMetadata {
  id?: string
  name?: string
  subject?: string
  conversationTimestamp?: number | bigint
  timestamp?: number | bigint
  archived?: boolean
  isArchived?: boolean
  unreadCount?: number
  pinned?: number
  muteExpiration?: number | bigint
  profilePictureUrl?: string | null
  owner?: string
  ownerPn?: string
  descOwner?: string
  descOwnerPn?: string
  participants?: Array<{
    id: string
    lid?: string | null
    phoneNumber?: string | null
    admin?: 'admin' | 'superadmin' | null
  }>
}

export class GroupHydrationService {
  constructor(
    private readonly communitySyncHandler: CommunitySyncHandler,
    private readonly chatSyncHandler: ChatSyncHandler,
    private readonly membershipSyncHandler: MembershipSyncHandler
  ) {}

  /**
   * Bulk-hydrates groups and participants by batching DB reads and writes.
   * Reports progress using the provided callback.
   */
  async hydrateGroups(
    groups: Record<string, BaileysGroupMetadata>,
    onProgress?: (progress: number, status: string) => void
  ): Promise<void> {
    const groupKeys = Object.keys(groups)
    const totalGroups = groupKeys.length
    if (totalGroups === 0) return

    const BATCH_SIZE = 25
    let processedCount = 0

    for (let i = 0; i < totalGroups; i += BATCH_SIZE) {
      const batchKeys = groupKeys.slice(i, i + BATCH_SIZE)
      const batchGroups: Record<string, BaileysGroupMetadata> = {}
      for (const k of batchKeys) {
        batchGroups[k] = groups[k]
      }

      await this.hydrateBatch(batchGroups)

      processedCount += batchKeys.length
      if (onProgress) {
        const progressVal = 95 + Math.round((processedCount / totalGroups) * 4)
        onProgress(progressVal, `Syncing group members... (${processedCount} / ${totalGroups})`)
      }
      await new Promise(r => setImmediate(r))
    }
  }

  private async hydrateBatch(groups: Record<string, BaileysGroupMetadata>): Promise<void> {
    // --- PHASE 1: Communities ---
    const communityJidToIdMap = await this.communitySyncHandler.syncCommunities(groups)

    // --- PHASE 2: Chats Upsert ---
    await this.chatSyncHandler.syncChats(groups, communityJidToIdMap)

    // --- PHASE 3 & 4: Participants & ChatMembers ---
    await this.membershipSyncHandler.syncMemberships(groups)
  }
}
