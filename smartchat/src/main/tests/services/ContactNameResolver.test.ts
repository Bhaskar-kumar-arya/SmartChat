import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContactNameResolver } from '../../services/contacts/ContactNameResolver'
import { IAliasRepository } from '../../services/contacts/IAliasRepository'

describe('ContactNameResolver', () => {
  let resolver: ContactNameResolver
  let aliasRepo: import('vitest').Mocked<IAliasRepository>
  let getMeJids: import('vitest').Mock
  let linkLidAndPn: import('vitest').Mock

  beforeEach(() => {
    aliasRepo = {
      findIdentityAliases: vi.fn(),
    } as any
    getMeJids = vi.fn().mockResolvedValue(['me@s.whatsapp.net'])
    linkLidAndPn = vi.fn().mockResolvedValue(undefined)
    resolver = new ContactNameResolver(aliasRepo, getMeJids, linkLidAndPn)
  })

  describe('getDisplayName static', () => {
    it('returns fallback if identity is null', () => {
      expect(ContactNameResolver.getDisplayName(null, 'FB')).toBe('FB')
    })
    it('prioritizes displayName', () => {
      expect(ContactNameResolver.getDisplayName({ displayName: 'DN', verifiedName: 'VN' })).toBe('DN')
    })
    it('uses verifiedName next', () => {
      expect(ContactNameResolver.getDisplayName({ verifiedName: 'VN', pushName: 'PN' })).toBe('VN')
    })
    it('prefixes pushName with ~', () => {
      expect(ContactNameResolver.getDisplayName({ pushName: 'PN' })).toBe('~ PN')
      expect(ContactNameResolver.getDisplayName({ pushName: '~ Already' })).toBe('~ Already')
    })
    it('uses phone number split if nothing else', () => {
      expect(ContactNameResolver.getDisplayName({ phoneNumber: '123@s.whatsapp.net' })).toBe('123')
    })
  })

  describe('batchResolveNames', () => {
    it('resolves me jids immediately', async () => {
      const res = await resolver.batchResolveNames(['me@s.whatsapp.net'])
      expect(res.get('me@s.whatsapp.net')).toBe('Me')
    })

    it('resolves aliases efficiently', async () => {
      aliasRepo.findIdentityAliases.mockResolvedValue([
        {
          jid: 'a@s.whatsapp.net',
          identityId: 1,
          identity: { displayName: 'Alice' }
        }
      ] as any)

      const res = await resolver.batchResolveNames(['a@s.whatsapp.net', 'b@s.whatsapp.net'])
      expect(res.get('a@s.whatsapp.net')).toBe('Alice')
      expect(res.get('b@s.whatsapp.net')).toBe('b') // fallback
    })

    it('uses runtime cache if lid is unknown but lid mapping is provided', async () => {
      aliasRepo.findIdentityAliases.mockResolvedValue([])
      const getPNForLID = vi.fn().mockResolvedValue('c@s.whatsapp.net')
      const sock = { signalRepository: { lidMapping: { getPNForLID } } } as any

      const res = await resolver.batchResolveNames(['123@lid'], sock)
      expect(res.get('123@lid')).toBe('c')
      expect(getPNForLID).toHaveBeenCalledWith('123@lid')
      expect(linkLidAndPn).toHaveBeenCalledWith('123@lid', 'c@s.whatsapp.net', 'runtime.cache')
    })
  })

  describe('resolveName', () => {
    it('falls back to chatName if available and identity is unknown', async () => {
      aliasRepo.findIdentityAliases.mockResolvedValue([])
      const name = await resolver.resolveName('unknown@s.whatsapp.net', 'Group Member A')
      expect(name).toBe('Group Member A')
    })

    it('resolves using batch method', async () => {
      aliasRepo.findIdentityAliases.mockResolvedValue([
        {
          jid: 'known@s.whatsapp.net',
          identityId: 1,
          identity: { displayName: 'Bob' }
        }
      ] as any)
      const name = await resolver.resolveName('known@s.whatsapp.net', 'Some Chat Name')
      expect(name).toBe('Bob') // overrides chatName
    })
  })
})
