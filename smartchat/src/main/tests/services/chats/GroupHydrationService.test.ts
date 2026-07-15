import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { GroupHydrationService } from '../../../services/chats/GroupHydrationService'
import { ICommunitySyncHandler } from '../../../services/chats/sync/ICommunitySyncHandler'
import { IChatSyncHandler } from '../../../services/chats/sync/IChatSyncHandler'
import { IMembershipSyncHandler } from '../../../services/chats/sync/IMembershipSyncHandler'
import { BaileysGroupMetadata } from '../../../services/whatsapp/types/group.types'

describe('GroupHydrationService', () => {
  let mockCommunitySyncHandler: Mocked<ICommunitySyncHandler>
  let mockChatSyncHandler: Mocked<IChatSyncHandler>
  let mockMembershipSyncHandler: Mocked<IMembershipSyncHandler>
  let service: GroupHydrationService

  beforeEach(() => {
    mockCommunitySyncHandler = {
      syncCommunities: vi.fn()
    }

    mockChatSyncHandler = {
      syncChats: vi.fn()
    }

    mockMembershipSyncHandler = {
      syncMemberships: vi.fn()
    }

    service = new GroupHydrationService(
      mockCommunitySyncHandler,
      mockChatSyncHandler,
      mockMembershipSyncHandler
    )
  })

  it('should not do anything if groups are empty', async () => {
    const onProgress = vi.fn()
    await service.hydrateGroups({}, onProgress)
    expect(mockCommunitySyncHandler.syncCommunities).not.toHaveBeenCalled()
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('should hydrate groups in batches and call handlers', async () => {
    const groups: Record<string, BaileysGroupMetadata> = {}
    // Create 30 groups to trigger batching (> 25)
    for (let i = 0; i < 30; i++) {
      groups[`group${i}@g.us`] = { subject: `Group ${i}` } as any
    }

    const mockCommunityMap = new Map<string, number>()
    mockCommunityMap.set('comm1@g.us', 1)
    mockCommunitySyncHandler.syncCommunities.mockResolvedValue(mockCommunityMap)

    const onProgress = vi.fn()

    await service.hydrateGroups(groups, onProgress)

    // Should process in 2 batches (25, then 5)
    expect(mockCommunitySyncHandler.syncCommunities).toHaveBeenCalledTimes(2)
    expect(mockChatSyncHandler.syncChats).toHaveBeenCalledTimes(2)
    expect(mockMembershipSyncHandler.syncMemberships).toHaveBeenCalledTimes(2)
    
    // Check if correct map was passed to chatSyncHandler
    expect(mockChatSyncHandler.syncChats).toHaveBeenCalledWith(expect.any(Object), mockCommunityMap)
    
    // onProgress should be called 2 times
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenLastCalledWith(99, 'Syncing group members... (30 / 30)')
  })
})
