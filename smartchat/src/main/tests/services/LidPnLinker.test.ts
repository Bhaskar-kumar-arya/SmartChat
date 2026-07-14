import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LidPnLinker } from '../../services/contacts/LidPnLinker'
import { IIdentityRepository } from '../../services/contacts/IIdentityRepository'
import { IAliasRepository } from '../../services/contacts/IAliasRepository'
import { ILidMapRepository } from '../../services/contacts/ILidMapRepository'

describe('LidPnLinker', () => {
  let linker: LidPnLinker
  let identityRepo: import('vitest').Mocked<IIdentityRepository>
  let aliasRepo: import('vitest').Mocked<IAliasRepository>
  let lidMapRepo: import('vitest').Mocked<ILidMapRepository>

  beforeEach(() => {
    identityRepo = {
      findIdentityByPhoneNumber: vi.fn(),
      findIdentityById: vi.fn(),
      countIdentityReferences: vi.fn(),
      deleteIdentity: vi.fn().mockResolvedValue(undefined),
      updateIdentity: vi.fn(),
      createIdentity: vi.fn(),
      findMeIdentity: vi.fn(),
    } as any

    aliasRepo = {
      findIdentityAlias: vi.fn(),
      upsertIdentityAlias: vi.fn(),
    } as any

    lidMapRepo = {
      upsertLidMap: vi.fn().mockResolvedValue(undefined),
    } as any

    linker = new LidPnLinker(identityRepo, aliasRepo, lidMapRepo)
  })

  it('should ignore invalid jids', async () => {
    await linker.linkLidAndPn('', 'pn', 'test')
    expect(lidMapRepo.upsertLidMap).not.toHaveBeenCalled()
  })

  it('should abort if already linked', async () => {
    const isAlreadyLinked = vi.fn().mockReturnValue(true)
    await linker.linkLidAndPn('lid@lid', 'pn@s.whatsapp.net', 'test', isAlreadyLinked)
    expect(lidMapRepo.upsertLidMap).not.toHaveBeenCalled()
  })

  it('should create new identity if neither exist', async () => {
    aliasRepo.findIdentityAlias.mockResolvedValue(null)
    identityRepo.findIdentityByPhoneNumber.mockResolvedValue(null)
    identityRepo.createIdentity.mockResolvedValue({ id: 10 } as any)

    const onLinked = vi.fn()
    await linker.linkLidAndPn('123@lid', '456@s.whatsapp.net', 'test', undefined, onLinked)

    expect(lidMapRepo.upsertLidMap).toHaveBeenCalledWith('123@lid', '456@s.whatsapp.net', 'test')
    expect(identityRepo.createIdentity).toHaveBeenCalledWith({ phoneNumber: '456@s.whatsapp.net' })
    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('456@s.whatsapp.net', 'PN', 10)
    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('123@lid', 'LID', 10)
    expect(onLinked).toHaveBeenCalledWith('123@lid', '456@s.whatsapp.net', 10)
  })

  it('should update identity if only lid alias exists', async () => {
    aliasRepo.findIdentityAlias.mockImplementation(async (jid) => {
      if (jid === '123@lid') return { jid, type: 'LID', identityId: 20 } as any
      return null
    })
    identityRepo.findIdentityByPhoneNumber.mockResolvedValue(null)
    
    await linker.linkLidAndPn('123@lid', '456@s.whatsapp.net', 'test')

    expect(identityRepo.updateIdentity).toHaveBeenCalledWith(20, { phoneNumber: '456@s.whatsapp.net' })
    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('456@s.whatsapp.net', 'PN', 20)
  })

  it('should merge lid to pn identity if pn identity exists', async () => {
    aliasRepo.findIdentityAlias.mockResolvedValue(null)
    identityRepo.findIdentityByPhoneNumber.mockResolvedValue({ id: 30 } as any)

    await linker.linkLidAndPn('123@lid', '456@s.whatsapp.net', 'test')

    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('123@lid', 'LID', 30)
    expect(identityRepo.deleteIdentity).not.toHaveBeenCalled()
  })

  it('should delete orphan lid identity if it has no references', async () => {
    aliasRepo.findIdentityAlias.mockImplementation(async (jid) => {
      if (jid === '123@lid') return { jid, type: 'LID', identityId: 40 } as any // old identity
      return null
    })
    identityRepo.findIdentityByPhoneNumber.mockResolvedValue({ id: 50 } as any) // new canonical identity
    
    identityRepo.countIdentityReferences.mockResolvedValue({
      aliases: 0, messages: 0, members: 0, reactions: 0
    } as any)

    await linker.linkLidAndPn('123@lid', '456@s.whatsapp.net', 'test')

    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('123@lid', 'LID', 50)
    expect(identityRepo.countIdentityReferences).toHaveBeenCalledWith(40)
    expect(identityRepo.deleteIdentity).toHaveBeenCalledWith(40)
  })
})
