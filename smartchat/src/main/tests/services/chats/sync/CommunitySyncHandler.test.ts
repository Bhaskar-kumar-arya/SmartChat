import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { CommunitySyncHandler } from '../../../../services/chats/sync/CommunitySyncHandler'
import { ISyncRepository } from '../../../../services/sync/ISyncRepository'
import { BaileysGroupMetadata } from '../../../../services/whatsapp/types/group.types'
import * as communityUtils from '../../../../utils/communityUtils'

vi.mock('../../../../utils/communityUtils', async () => {
  const actual = await vi.importActual('../../../../utils/communityUtils')
  return {
    ...actual as any,
    parseCommunityMetadata: vi.fn()
  }
})

describe('CommunitySyncHandler', () => {
  let mockSyncRepo: Mocked<ISyncRepository>
  let handler: CommunitySyncHandler

  beforeEach(() => {
    mockSyncRepo = {
      bulkUpsertCommunities: vi.fn(),
      bulkUpdateCommunityAnnounces: vi.fn().mockResolvedValue(undefined)
    } as any

    handler = new CommunitySyncHandler(mockSyncRepo)
    vi.clearAllMocks()
  })

  it('should return empty map if no groups are provided', async () => {
    const result = await handler.syncCommunities({})
    expect(result.size).toBe(0)
    expect(mockSyncRepo.bulkUpsertCommunities).not.toHaveBeenCalled()
  })

  it('should upsert communities and return a map of jid to id', async () => {
    const groups: Record<string, BaileysGroupMetadata> = {
      'root@g.us': { subject: 'Root Group' } as any,
      'announce@g.us': { subject: 'Announce Group' } as any
    }

    vi.mocked(communityUtils.parseCommunityMetadata).mockImplementation(((jid: string, _raw: any) => {
      if (jid === 'root@g.us') return { hasCommunityData: true, rootJid: 'root@g.us', isAnnounce: false, type: 'PARENT' }
      if (jid === 'announce@g.us') return { hasCommunityData: true, rootJid: 'root@g.us', isAnnounce: true, type: 'DEFAULT_SUB' }
      return { hasCommunityData: false }
    }) as any)

    mockSyncRepo.bulkUpsertCommunities.mockResolvedValue([
      { id: 10, jid: 'root@g.us', name: 'Root Group', announceJid: null } as any
    ])

    const result = await handler.syncCommunities(groups)

    expect(result.size).toBe(1)
    expect(result.get('root@g.us')).toBe(10)

    expect(mockSyncRepo.bulkUpsertCommunities).toHaveBeenCalledWith([{ jid: 'root@g.us', name: 'Root Group' }])
    expect(mockSyncRepo.bulkUpdateCommunityAnnounces).toHaveBeenCalledWith([{ id: 10, announceJid: 'announce@g.us' }])
  })
})
