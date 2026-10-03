import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageActionService } from '../../services/messages/MessageActionService'

/**
 * Characterization (F-MSG-5): reactToMessage sends via the socket, resolves the
 * logged-in user's identity and mirrors the reaction into the DB.
 */
describe('MessageActionService.reactToMessage', () => {
  let service: MessageActionService
  let reactionRepo: any
  let queryRepo: any
  let identRepo: any
  let contactService: any
  let sock: any

  beforeEach(() => {
    reactionRepo = {
      upsertReaction: vi.fn().mockResolvedValue(undefined),
      deleteReactions: vi.fn().mockResolvedValue(undefined)
    }
    queryRepo = {
      findMessageById: vi.fn().mockResolvedValue({ id: 'm1', chatJid: 'chat@s.whatsapp.net', fromMe: false })
    }
    identRepo = { findMeIdentity: vi.fn().mockResolvedValue({ id: 9 }) }
    contactService = {
      resolveLidFromJid: vi.fn().mockImplementation((j: string) => Promise.resolve(j)),
      getIdentityIdByJid: vi.fn().mockResolvedValue(null)
    }
    sock = { sendMessage: vi.fn().mockResolvedValue({ key: {} }), user: { id: 'me:1@s.whatsapp.net' } }

    service = new MessageActionService(
      {} as any, reactionRepo, queryRepo, identRepo, contactService, {} as any, {} as any, {} as any, () => null, {} as any
    )
  })

  it('sends the reaction and upserts it for the persisted me-identity', async () => {
    const res = await service.reactToMessage(sock, 'm1', '👍')
    expect(sock.sendMessage).toHaveBeenCalledWith('chat@s.whatsapp.net', {
      react: { text: '👍', key: { remoteJid: 'chat@s.whatsapp.net', fromMe: false, id: 'm1', participant: undefined } }
    })
    expect(reactionRepo.upsertReaction).toHaveBeenCalledWith('m1', 9, '👍', expect.any(BigInt))
    expect(res).toMatchObject({ success: true, messageId: 'm1', reaction: '👍' })
  })

  it('an empty reaction removes the stored reaction', async () => {
    await service.reactToMessage(sock, 'm1', '')
    expect(reactionRepo.deleteReactions).toHaveBeenCalledWith('m1', 9)
    expect(reactionRepo.upsertReaction).not.toHaveBeenCalled()
  })

  it('falls back to the socket user JID, then LID, when the me-identity is not persisted', async () => {
    identRepo.findMeIdentity.mockResolvedValue(null)
    sock.user = { id: 'me:1@s.whatsapp.net', lid: 'melid:2@lid' }
    contactService.getIdentityIdByJid.mockImplementation((j: string) => Promise.resolve(j === 'melid' ? 33 : null))
    await service.reactToMessage(sock, 'm1', '🔥')
    expect(contactService.getIdentityIdByJid).toHaveBeenCalledWith('me')
    expect(contactService.getIdentityIdByJid).toHaveBeenCalledWith('melid')
    expect(reactionRepo.upsertReaction).toHaveBeenCalledWith('m1', 33, '🔥', expect.any(BigInt))
  })

  it('throws (after sending) when the logged-in identity cannot be resolved', async () => {
    identRepo.findMeIdentity.mockResolvedValue(null)
    await expect(service.reactToMessage(sock, 'm1', '🔥')).rejects.toThrow(/resolve logged-in user identity/)
    expect(reactionRepo.upsertReaction).not.toHaveBeenCalled()
  })

  it('throws when the target message is unknown, without sending', async () => {
    queryRepo.findMessageById.mockResolvedValue(null)
    await expect(service.reactToMessage(sock, 'zz', '👍')).rejects.toThrow(/not found/)
    expect(sock.sendMessage).not.toHaveBeenCalled()
  })
})
