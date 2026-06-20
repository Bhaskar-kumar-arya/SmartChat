import { ICommunitySyncHandler } from './sync/ICommunitySyncHandler'
import { IChatSyncHandler } from './sync/IChatSyncHandler'
import { IMembershipSyncHandler } from './sync/IMembershipSyncHandler'
import { BaileysGroupMetadata } from './types'
import { IGroupHydrationService } from './IGroupHydrationService'

export class GroupHydrationService implements IGroupHydrationService {
  constructor(
    private readonly communitySyncHandler: ICommunitySyncHandler,
    private readonly chatSyncHandler: IChatSyncHandler,
    private readonly membershipSyncHandler: IMembershipSyncHandler
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
