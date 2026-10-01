import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { IdentityReconciliationService } from '../../services/contacts/IdentityReconciliationService'
import { IContactMutationService } from '../../services/contacts/IContactService'

describe('IdentityReconciliationService', () => {
  let service: IdentityReconciliationService
  let identityRepo: { findLidStubsWithPushName: Mock; findPnIdentitiesByPushNames: Mock; mergeIdentityInto: Mock }
  let lidMapRepo: { findLidMaps: Mock }
  let contactService: import('vitest').Mocked<IContactMutationService>

  const stub = (id: number, pushName: string, lid: string) => ({
    id, pushName, displayName: null, verifiedName: null, profilePictureUrl: null, aliases: [{ jid: lid, type: 'LID' }]
  })

  beforeEach(() => {
    identityRepo = {
      findLidStubsWithPushName: vi.fn().mockResolvedValue([]),
      findPnIdentitiesByPushNames: vi.fn().mockResolvedValue([]),
      mergeIdentityInto: vi.fn().mockResolvedValue(undefined)
    }
    lidMapRepo = { findLidMaps: vi.fn().mockResolvedValue([]) }

    contactService = {
      linkLidAndPn: vi.fn(),
      batchGetIdentityIds: vi.fn(),
      getIdentityIdByJid: vi.fn(),
      upsertContact: vi.fn(),
      registerMe: vi.fn(),
    } as any

    service = new IdentityReconciliationService(identityRepo as any, lidMapRepo as any, contactService)
  })

  it('deduplicateIdentities does nothing if no stubs are found', async () => {
    const result = await service.deduplicateIdentities()
    expect(result).toEqual({ merged: 0, skipped: 0 })
  })

  it('deduplicateIdentities delegates the merge to IdentityRepository.mergeIdentityInto', async () => {
    identityRepo.findLidStubsWithPushName.mockResolvedValue([stub(1, 'Alice', 'a@lid')])
    identityRepo.findPnIdentitiesByPushNames.mockResolvedValue([{ id: 2, pushName: 'Alice', phoneNumber: '123', displayName: 'Alice' }])
    // P2-S5-02: corroborate the pushName match with a LidMap ledger row
    lidMapRepo.findLidMaps.mockResolvedValue([{ lid: 'a@lid', pn: '123' }])

    const result = await service.deduplicateIdentities()

    expect(identityRepo.mergeIdentityInto).toHaveBeenCalledTimes(1)
    expect(identityRepo.mergeIdentityInto).toHaveBeenCalledWith(1, 2)
    expect(result).toEqual({ merged: 1, skipped: 0 })
  })

  it('deduplicateIdentities counts a failed merge as skipped', async () => {
    identityRepo.findLidStubsWithPushName.mockResolvedValue([stub(1, 'Bob', 'b@lid')])
    identityRepo.findPnIdentitiesByPushNames.mockResolvedValue([{ id: 2, pushName: 'Bob', phoneNumber: '999', displayName: 'Bob' }])
    lidMapRepo.findLidMaps.mockResolvedValue([{ lid: 'b@lid', pn: '999' }])
    identityRepo.mergeIdentityInto.mockRejectedValue(new Error('DB locked'))

    const result = await service.deduplicateIdentities()

    expect(result).toEqual({ merged: 0, skipped: 1 })
  })

  it('P2-S5-02: does NOT merge on a bare common-pushName match with no corroboration', async () => {
    identityRepo.findLidStubsWithPushName.mockResolvedValue([stub(1, 'Mom', 'x@lid')])
    identityRepo.findPnIdentitiesByPushNames.mockResolvedValue([{ id: 2, pushName: 'Mom', phoneNumber: '111', displayName: 'Mom' }])

    const result = await service.deduplicateIdentities()

    expect(identityRepo.mergeIdentityInto).not.toHaveBeenCalled()
    expect(result).toEqual({ merged: 0, skipped: 1 })
  })

  it('P2-S5-02: merges a distinctive multi-word pushName without a ledger row', async () => {
    identityRepo.findLidStubsWithPushName.mockResolvedValue([stub(1, 'John Smith', 'y@lid')])
    identityRepo.findPnIdentitiesByPushNames.mockResolvedValue([{ id: 2, pushName: 'John Smith', phoneNumber: '222', displayName: 'John Smith' }])

    const result = await service.deduplicateIdentities()

    expect(identityRepo.mergeIdentityInto).toHaveBeenCalledWith(1, 2)
    expect(result).toEqual({ merged: 1, skipped: 0 })
  })

  it('reconcileLidPnFromJids links LID and PN when both are present', async () => {
    contactService.linkLidAndPn.mockResolvedValue(undefined)
    await service.reconcileLidPnFromJids(['123@s.whatsapp.net', '456@lid', null], 'test')
    expect(contactService.linkLidAndPn).toHaveBeenCalledWith('456@lid', '123@s.whatsapp.net', 'test')
  })

  it('reconcileLidPnFromJids does nothing if only one is present', async () => {
    await service.reconcileLidPnFromJids(['123@s.whatsapp.net'], 'test')
    expect(contactService.linkLidAndPn).not.toHaveBeenCalled()
  })
})
