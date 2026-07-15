import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { MembershipSyncHandler } from '../../../../services/chats/sync/MembershipSyncHandler'
import { ISyncRepository } from '../../../../services/sync/ISyncRepository'
import { IContactCacheManager } from '../../../../services/contacts/IContactService'
import { BaileysGroupMetadata } from '../../../../services/whatsapp/types/group.types'

describe('MembershipSyncHandler', () => {
  let mockSyncRepo: Mocked<ISyncRepository>
  let mockContactService: Mocked<IContactCacheManager>
  let handler: MembershipSyncHandler

  beforeEach(() => {
    mockSyncRepo = {
      findIdentityAliases: vi.fn(),
      findIdentities: vi.fn(),
      findLidMaps: vi.fn(),
      bulkCreateIdentities: vi.fn(),
      findIdentitiesByPhoneNumbers: vi.fn(),
      createIdentity: vi.fn(),
      bulkUpdateIdentities: vi.fn(),
      bulkCreateIdentityAliases: vi.fn(),
      bulkUpdateIdentityAliases: vi.fn(),
      bulkUpsertLidMaps: vi.fn(),
      findExistingMemberRoles: vi.fn(),
      bulkUpsertChatMembers: vi.fn()
    } as any

    mockContactService = {
      warmLinkCache: vi.fn(),
      populateIdentityIdCache: vi.fn()
    } as any

    handler = new MembershipSyncHandler(mockSyncRepo, mockContactService)
  })

  it('should not do anything if groups are empty', async () => {
    await handler.syncMemberships({})
    expect(mockSyncRepo.findIdentityAliases).not.toHaveBeenCalled()
  })

  it('should process participants and memberships correctly', async () => {
    const groups: Record<string, BaileysGroupMetadata> = {
      'group1@g.us': {
        owner: 'user1@lid',
        ownerPn: '1234567890@s.whatsapp.net',
        participants: [
          { id: '1234567890@s.whatsapp.net', lid: 'user1@lid', admin: 'superadmin' },
          { id: '9876543210@s.whatsapp.net', admin: null }
        ]
      } as any
    }

    mockSyncRepo.findIdentityAliases.mockResolvedValue([
      { jid: '1234567890@s.whatsapp.net', type: 'PN', identityId: 1 }
    ])
    
    mockSyncRepo.findIdentities.mockResolvedValue([
      { id: 1, phoneNumber: '1234567890@s.whatsapp.net', pushName: null, isMe: false } as any
    ])

    mockSyncRepo.findLidMaps.mockResolvedValue([])
    
    mockSyncRepo.bulkCreateIdentities.mockResolvedValue()
    mockSyncRepo.findIdentitiesByPhoneNumbers.mockResolvedValue([
      { id: 2, phoneNumber: '9876543210@s.whatsapp.net', pushName: null, isMe: false } as any
    ])

    mockSyncRepo.findExistingMemberRoles.mockResolvedValue([])

    await handler.syncMemberships(groups)

    expect(mockSyncRepo.bulkCreateIdentities).toHaveBeenCalledWith(['9876543210@s.whatsapp.net'])
    expect(mockSyncRepo.bulkCreateIdentityAliases).toHaveBeenCalledWith([
      expect.objectContaining({ jid: 'user1@lid', type: 'LID', identityId: 1 })
    ])
    
    expect(mockSyncRepo.bulkUpsertLidMaps).toHaveBeenCalledWith([
      { lid: 'user1@lid', pn: '1234567890@s.whatsapp.net', source: 'group.metadata.owner' }
    ], expect.any(Set))

    expect(mockSyncRepo.bulkUpsertChatMembers).toHaveBeenCalledWith([
      { chatJid: 'group1@g.us', identityId: 1, role: 'SUPERADMIN' },
      { chatJid: 'group1@g.us', identityId: 2, role: 'MEMBER' }
    ], expect.any(Map))
  })
})
