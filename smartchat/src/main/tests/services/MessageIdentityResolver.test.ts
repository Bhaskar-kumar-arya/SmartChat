import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageIdentityResolver } from '../../services/messages/MessageIdentityResolver'
import { IContactMutationService, IContactQueryService } from '../../services/contacts/IContactService'
import { IIdentityRepository } from '../../services/contacts/IIdentityRepository'
import { IIdentityReconciliationService } from '../../services/contacts/IIdentityReconciliationService'
import { WAMessageKey } from '../../services/whatsapp/types'

describe('MessageIdentityResolver', () => {
  let resolver: MessageIdentityResolver
  let contactService: import('vitest').Mocked<IContactMutationService & IContactQueryService>
  let identityRepo: import('vitest').Mocked<IIdentityRepository>
  let reconciliationService: import('vitest').Mocked<IIdentityReconciliationService>

  beforeEach(() => {
    contactService = {
      getIdentityIdByJid: vi.fn(),
      upsertContact: vi.fn(),
      linkLidAndPn: vi.fn(),
    } as any

    identityRepo = {
      findMeIdentity: vi.fn(),
    } as any

    reconciliationService = {
      reconcileLidPnFromJids: vi.fn(),
    } as any

    resolver = new MessageIdentityResolver(contactService, identityRepo, reconciliationService)
  })

  it('resolveSenderJid resolves to user from sock if fromMe', async () => {
    const key: WAMessageKey = { fromMe: true, remoteJid: 'chat@g.us' }
    const sock = { user: { id: '1234567890:12' } } as any
    const res = await resolver.resolveSenderJid(key, sock)
    expect(res).toBe('1234567890@s.whatsapp.net')
  })

  it('resolveSenderJid resolves to participant if group', async () => {
    const key: WAMessageKey = { fromMe: false, remoteJid: 'chat@g.us', participant: 'user@s.whatsapp.net' }
    const res = await resolver.resolveSenderJid(key, null)
    expect(res).toBe('user@s.whatsapp.net')
  })

  it('resolveSenderId upserts contact if not found initially', async () => {
    contactService.getIdentityIdByJid
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(5)
    
    contactService.upsertContact.mockResolvedValue(undefined)

    const res = await resolver.resolveSenderId('new@s.whatsapp.net')
    expect(res).toBe(5)
    expect(contactService.upsertContact).toHaveBeenCalledWith({ id: 'new@s.whatsapp.net' })
  })
})
