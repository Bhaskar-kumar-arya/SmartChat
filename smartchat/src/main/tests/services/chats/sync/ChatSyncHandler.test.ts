import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { ChatSyncHandler } from '../../../../services/chats/sync/ChatSyncHandler'
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

describe('ChatSyncHandler', () => {
  let mockSyncRepo: Mocked<ISyncRepository>
  let handler: ChatSyncHandler

  beforeEach(() => {
    mockSyncRepo = {
      findExistingChats: vi.fn(),
      bulkCreateChats: vi.fn(),
      bulkUpdateChats: vi.fn()
    } as any

    handler = new ChatSyncHandler(mockSyncRepo)
    vi.clearAllMocks()
  })

  it('should not do anything if groups are empty', async () => {
    await handler.syncChats({}, new Map())
    expect(mockSyncRepo.findExistingChats).not.toHaveBeenCalled()
  })

  it('should bulk insert and update chats correctly', async () => {
    const groups: Record<string, BaileysGroupMetadata> = {
      'new-group@g.us': { subject: 'New Group', unreadCount: 5 } as any,
      'existing-group@g.us': { subject: 'Existing Group', archived: true, muteExpiration: 12345 } as any
    }

    const communityJidToIdMap = new Map<string, number>()
    communityJidToIdMap.set('root-comm@g.us', 42)

    vi.mocked(communityUtils.parseCommunityMetadata).mockImplementation(((jid: string, _raw: any) => {
      if (jid === 'new-group@g.us') return { hasCommunityData: true, rootJid: 'root-comm@g.us', type: 'SUB' }
      return { hasCommunityData: false }
    }) as any)

    mockSyncRepo.findExistingChats.mockResolvedValue([
      { jid: 'existing-group@g.us' } as any
    ])

    await handler.syncChats(groups, communityJidToIdMap)

    expect(mockSyncRepo.findExistingChats).toHaveBeenCalledWith(['new-group@g.us', 'existing-group@g.us'])

    expect(mockSyncRepo.bulkCreateChats).toHaveBeenCalledWith([
      expect.objectContaining({
        jid: 'new-group@g.us',
        name: 'New Group',
        communityId: 42,
        type: 'SUB',
        unreadCount: 5,
        isArchived: false,
        timestamp: BigInt(0),
        pinned: 0,
        muteExpiration: BigInt(0)
      })
    ])

    expect(mockSyncRepo.bulkUpdateChats).toHaveBeenCalledWith([
      expect.objectContaining({
        jid: 'existing-group@g.us',
        name: 'Existing Group',
        isArchived: true,
        muteExpiration: BigInt(12345)
      })
    ])
  })
})
