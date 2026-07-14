import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroupMembershipService } from '../../services/chats/GroupMembershipService'
import { IChatMemberRepository } from '../../services/chats/IChatMemberRepository'
import { IContactMutationService, IContactQueryService } from '../../services/contacts/IContactService'

describe('GroupMembershipService', () => {
  let service: GroupMembershipService
  let chatMemberRepo: import('vitest').Mocked<IChatMemberRepository>
  let contactService: import('vitest').Mocked<IContactMutationService & IContactQueryService>

  beforeEach(() => {
    chatMemberRepo = {
      upsertChatMember: vi.fn(),
    } as any

    contactService = {
      batchGetIdentityIds: vi.fn().mockResolvedValue(new Map()),
      getIdentityIdByJid: vi.fn().mockResolvedValue(1),
      linkLidAndPn: vi.fn().mockResolvedValue(undefined),
      upsertContact: vi.fn().mockResolvedValue(undefined),
    } as any

    service = new GroupMembershipService(chatMemberRepo, contactService)
  })

  it('syncGroupMembers links lid and pn if both exist', async () => {
    contactService.getIdentityIdByJid.mockResolvedValue(1)
    chatMemberRepo.upsertChatMember.mockResolvedValue({} as any)

    await service.syncGroupMembers('group@g.us', [
      { id: 'user@lid', lid: 'user@lid', phoneNumber: 'user@s.whatsapp.net', admin: null }
    ])

    expect(contactService.linkLidAndPn).toHaveBeenCalledWith('user@lid', 'user@s.whatsapp.net', 'group.participant')
    expect(chatMemberRepo.upsertChatMember).toHaveBeenCalledWith('group@g.us', 1, 'MEMBER')
  })

  it('linkGroupMetadataOwners links owner and descOwner LIDs and PNs', async () => {
    contactService.linkLidAndPn.mockResolvedValue(undefined)
    
    await service.linkGroupMetadataOwners({
      id: 'group@g.us',
      owner: 'owner@lid',
      ownerPn: 'owner@s.whatsapp.net',
      descOwner: 'desc@lid',
      descOwnerPn: 'desc@s.whatsapp.net'
    } as any)

    expect(contactService.linkLidAndPn).toHaveBeenCalledWith('owner@lid', 'owner@s.whatsapp.net', 'group.metadata.owner')
    expect(contactService.linkLidAndPn).toHaveBeenCalledWith('desc@lid', 'desc@s.whatsapp.net', 'group.metadata.descOwner')
  })
})
