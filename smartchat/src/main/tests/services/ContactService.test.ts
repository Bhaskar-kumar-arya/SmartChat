import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContactService } from '../../services/contacts/ContactService'
import { IIdentityRepository } from '../../services/contacts/IIdentityRepository'
import { IAliasRepository } from '../../services/contacts/IAliasRepository'
import { ILidMapRepository } from '../../services/contacts/ILidMapRepository'
import { ILidPnLinker } from '../../services/contacts/ILidPnLinker'
import { IContactNameResolver } from '../../services/contacts/IContactService'
import { IContactCache } from '../../services/contacts/IContactCache'
import { IJidStrategy } from '../../services/contacts/IJidStrategy'

describe('ContactService', () => {
  let service: ContactService
  let identityRepo: import('vitest').Mocked<IIdentityRepository>
  let aliasRepo: import('vitest').Mocked<IAliasRepository>
  let lidMapRepo: import('vitest').Mocked<ILidMapRepository>
  let lidPnLinker: import('vitest').Mocked<ILidPnLinker>
  let nameResolver: import('vitest').Mocked<IContactNameResolver>
  let cache: import('vitest').Mocked<IContactCache>
  let strategy: import('vitest').Mocked<IJidStrategy>

  beforeEach(() => {
    identityRepo = {
      findMeIdentity: vi.fn(),
      createIdentity: vi.fn(),
      updateIdentity: vi.fn(),
      findIdentityByPhoneNumber: vi.fn(),
      findIdentityById: vi.fn(),
    } as any

    aliasRepo = {
      findIdentityAlias: vi.fn(),
      upsertIdentityAlias: vi.fn(),
      findLidAliasByIdentityId: vi.fn(),
      findIdentityAliasesMinimal: vi.fn(),
    } as any

    lidMapRepo = {
      findLidMap: vi.fn(),
      upsertLidMap: vi.fn().mockResolvedValue(undefined),
    } as any

    lidPnLinker = {
      linkLidAndPn: vi.fn(),
    } as any

    nameResolver = {
      batchResolveNames: vi.fn(),
      resolveName: vi.fn(),
    } as any

    cache = {
      clear: vi.fn(),
      getMeJids: vi.fn(),
      setMeJids: vi.fn(),
      addLink: vi.fn(),
      populateIdentityIdCache: vi.fn(),
      hasIdentityId: vi.fn(),
      getIdentityId: vi.fn(),
      setIdentityId: vi.fn(),
      hasLink: vi.fn(),
    } as any

    strategy = {
      aliasType: 'PN',
      supports: vi.fn().mockReturnValue(true),
    }

    service = new ContactService(
      identityRepo,
      aliasRepo,
      lidMapRepo,
      lidPnLinker,
      nameResolver,
      cache,
      [strategy]
    )
  })

  it('getMeJids returns cached jids if available', async () => {
    cache.getMeJids.mockReturnValue(['me@s.whatsapp.net'])
    const jids = await service.getMeJids()
    expect(jids).toEqual(['me@s.whatsapp.net'])
  })

  it('getMeJids fetches from db if cache is empty', async () => {
    cache.getMeJids.mockReturnValue(null)
    identityRepo.findMeIdentity.mockResolvedValue({
      phoneNumber: 'me@s.whatsapp.net',
      aliases: [{ jid: 'me@lid' }]
    } as any)

    const jids = await service.getMeJids()
    expect(jids).toContain('me@s.whatsapp.net')
    expect(jids).toContain('me@lid')
    expect(cache.setMeJids).toHaveBeenCalled()
  })

  it('registerMe creates a new identity if not found', async () => {
    aliasRepo.findIdentityAlias.mockResolvedValue(null)
    identityRepo.createIdentity.mockResolvedValue({ id: 1 } as any)

    await service.registerMe({ id: 'me@s.whatsapp.net', lid: 'me@lid', name: 'My Name' })

    expect(identityRepo.createIdentity).toHaveBeenCalledWith({
      phoneNumber: 'me@s.whatsapp.net',
      displayName: 'My Name',
      isMe: true
    })
    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('me@s.whatsapp.net', 'PN', 1)
    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('me@lid', 'LID', 1)
    expect(lidMapRepo.upsertLidMap).toHaveBeenCalledWith('me@lid', 'me@s.whatsapp.net', 'registerMe')
    expect(cache.setMeJids).toHaveBeenCalledWith(null)
  })

  it('resolveLidFromJid returns the lid if mapping exists', async () => {
    aliasRepo.findIdentityAlias.mockResolvedValue({ identityId: 10 } as any)
    aliasRepo.findLidAliasByIdentityId.mockResolvedValue({ jid: '123@lid' } as any)

    const lid = await service.resolveLidFromJid('456@s.whatsapp.net')
    expect(lid).toBe('123@lid')
  })

  it('batchGetIdentityIds efficiently batches missing jids', async () => {
    cache.hasIdentityId.mockImplementation((jid) => jid === 'known@s.whatsapp.net')
    cache.getIdentityId.mockImplementation((jid) => jid === 'known@s.whatsapp.net' ? 100 : undefined)
    
    aliasRepo.findIdentityAliasesMinimal.mockResolvedValue([
      { jid: 'unknown@s.whatsapp.net', identityId: 200 }
    ] as any)

    const result = await service.batchGetIdentityIds(['known@s.whatsapp.net', 'unknown@s.whatsapp.net'])

    expect(result.get('known@s.whatsapp.net')).toBe(100)
    expect(result.get('unknown@s.whatsapp.net')).toBe(200)
    expect(cache.setIdentityId).toHaveBeenCalledWith('unknown@s.whatsapp.net', 200)
  })

  it('upsertContact creates a new identity if it does not exist', async () => {
    cache.hasIdentityId.mockReturnValue(false)
    identityRepo.findIdentityByPhoneNumber.mockResolvedValue(null)
    aliasRepo.findIdentityAlias.mockResolvedValue(null)
    lidMapRepo.findLidMap.mockResolvedValue(null)
    identityRepo.createIdentity.mockResolvedValue({ id: 5 } as any)

    await service.upsertContact({
      id: '555@s.whatsapp.net',
      name: 'Bob',
      lid: '555@lid'
    })

    expect(identityRepo.createIdentity).toHaveBeenCalledWith({
      phoneNumber: '555@s.whatsapp.net',
      displayName: 'Bob',
      pushName: undefined,
      verifiedName: undefined
    })
    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('555@s.whatsapp.net', 'PN', 5)
    expect(aliasRepo.upsertIdentityAlias).toHaveBeenCalledWith('555@lid', 'LID', 5)
  })
})
