import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroupMembershipService } from '../../services/chats/GroupMembershipService'
import { IChatMemberRepository } from '../../services/chats/IChatMemberRepository'
import { IMembershipSyncHandler } from '../../services/chats/sync/IMembershipSyncHandler'
import { IContactMutationService, IContactQueryService } from '../../services/contacts/IContactService'

describe('GroupMembershipService', () => {
  let service: GroupMembershipService
  let chatMemberRepo: import('vitest').Mocked<IChatMemberRepository>
  let membershipSyncHandler: import('vitest').Mocked<IMembershipSyncHandler>
  let contactService: import('vitest').Mocked<IContactMutationService & IContactQueryService>

  beforeEach(() => {
    chatMemberRepo = {
      upsertChatMember: vi.fn(),
      ensureChat: vi.fn().mockResolvedValue(true),
    } as any

    contactService = {
      batchGetIdentityIds: vi.fn().mockResolvedValue(new Map()),
      getIdentityIdByJid: vi.fn().mockResolvedValue(1),
      linkLidAndPn: vi.fn().mockResolvedValue(undefined),
      upsertContact: vi.fn().mockResolvedValue(undefined),
    } as any

    membershipSyncHandler = { syncMemberships: vi.fn().mockResolvedValue(undefined) } as unknown as import('vitest').Mocked<IMembershipSyncHandler>
    service = new GroupMembershipService(chatMemberRepo, contactService, membershipSyncHandler)
  })

  it('syncGroupMembers ensures the chat then delegates to the batched handler without pruning', async () => {
    const participants = [{ id: 'user@lid', lid: 'user@lid', phoneNumber: 'user@s.whatsapp.net', admin: 'admin' as const }]
    await service.syncGroupMembers('group@g.us', participants)

    expect(chatMemberRepo.ensureChat).toHaveBeenCalledWith('group@g.us')
    expect(membershipSyncHandler.syncMemberships).toHaveBeenCalledWith(
      { 'group@g.us': { id: 'group@g.us', participants } },
      { prune: false }
    )
  })

  it('syncGroupMembers skips empty lists and entries without id', async () => {
    await service.syncGroupMembers('group@g.us', [{ id: '' }])
    expect(membershipSyncHandler.syncMemberships).not.toHaveBeenCalled()
  })

  it('syncGroupMembers does not sync when the parent chat cannot be ensured', async () => {
    chatMemberRepo.ensureChat.mockResolvedValue(false)
    await service.syncGroupMembers('group@g.us', [{ id: 'a@s.whatsapp.net' }])
    expect(membershipSyncHandler.syncMemberships).not.toHaveBeenCalled()
  })

  it.each([
    ['add', null],
    ['demote', null],
    ['promote', 'admin']
  ] as const)('applyParticipantRoleChange(%s) maps to admin=%s in one batch', async (action, admin) => {
    await service.applyParticipantRoleChange('group@g.us', ['a@s.whatsapp.net', 'b@lid'], action)
    expect(membershipSyncHandler.syncMemberships).toHaveBeenCalledTimes(1)
    expect(membershipSyncHandler.syncMemberships).toHaveBeenCalledWith(
      { 'group@g.us': { id: 'group@g.us', participants: [{ id: 'a@s.whatsapp.net', admin }, { id: 'b@lid', admin }] } },
      { prune: false }
    )
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
