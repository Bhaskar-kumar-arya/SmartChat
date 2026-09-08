import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageService } from '../../services/messages/MessageService'
import { MessageParser } from '../../services/messages/MessageParser'

/**
 * Regression tests for:
 *  - P2-S2-01 — re-index message on decrypt / edit; skip non-indexable types
 *  - P2-S2-05 — processReaction must not emit reaction:processed when nothing was persisted
 */
describe('MessageService — re-index & reaction persistence', () => {
  let service: MessageService
  let embeddingService: any
  let repository: any
  let queryRepository: any
  let reactionRepository: any
  let identityResolver: any
  let contactService: any
  let busEmit: any

  beforeEach(() => {
    embeddingService = { indexMessage: vi.fn().mockResolvedValue(undefined) }
    repository = {
      decryptMessage: vi.fn().mockResolvedValue(undefined),
      editMessage: vi.fn().mockResolvedValue(undefined)
    }
    queryRepository = { findMessageTypeAndContent: vi.fn().mockResolvedValue(null) }
    reactionRepository = { upsertReaction: vi.fn().mockResolvedValue(undefined) }
    contactService = { batchResolveNames: vi.fn().mockResolvedValue(new Map()) }
    identityResolver = {
      resolveReactorJid: vi.fn().mockResolvedValue(null),
      resolveMeSenderId: vi.fn().mockResolvedValue(null),
      resolveSenderId: vi.fn().mockResolvedValue(null),
      linkLidAndPn: vi.fn().mockResolvedValue(undefined)
    }
    busEmit = vi.fn().mockResolvedValue(undefined)

    service = new MessageService(
      contactService,
      {} as any,
      embeddingService,
      {} as any,
      vi.fn().mockReturnValue({ emit: busEmit }),
      new MessageParser(),
      repository,
      queryRepository,
      reactionRepository,
      {} as any,
      identityResolver,
      []
    )
  })

  it('P2-S2-01: decryptMessageInDb re-indexes with the decrypted text', async () => {
    await service.decryptMessageInDb('m1', 'conversation', 'the real secret text', {})
    expect(repository.decryptMessage).toHaveBeenCalledWith('m1', 'conversation', 'the real secret text', {})
    expect(embeddingService.indexMessage).toHaveBeenCalledWith('m1', 'the real secret text')
  })

  it('P2-S2-01: decryptMessageInDb does NOT index non-indexable types', async () => {
    await service.decryptMessageInDb('m2', 'system', 'some stub text', {})
    expect(embeddingService.indexMessage).not.toHaveBeenCalled()
  })

  it('P2-S2-01: editMessageInDb re-indexes with the edited text', async () => {
    await service.editMessageInDb('m3', 'edited body', { conversation: 'edited body' })
    expect(repository.editMessage).toHaveBeenCalled()
    expect(embeddingService.indexMessage).toHaveBeenCalledWith('m3', 'edited body')
  })

  it('P2-S2-01: editMessageInDb skips indexing when there is no text', async () => {
    await service.editMessageInDb('m4', null, {})
    expect(embeddingService.indexMessage).not.toHaveBeenCalled()
  })

  it('P2-S2-05: processReaction does not emit / persist when reactor is unresolved', async () => {
    const update = {
      key: { id: 'target-1' },
      reaction: { key: { id: 'r1', remoteJid: 'g@g.us', fromMe: false }, text: '👍', senderTimestampMs: 1700000000000 }
    }
    await service.processReaction(update, null)

    expect(reactionRepository.upsertReaction).not.toHaveBeenCalled()
    expect(queryRepository.findMessageTypeAndContent).not.toHaveBeenCalled()
    expect(busEmit).not.toHaveBeenCalled()
  })

  it('P2-S2-05: processReaction still emits when reactor resolves', async () => {
    identityResolver.resolveSenderId.mockResolvedValue(55)
    identityResolver.resolveReactorJid.mockResolvedValue('someone@s.whatsapp.net')
    const update = {
      key: { id: 'target-2' },
      reaction: { key: { id: 'r2', remoteJid: 'g@g.us', fromMe: false }, text: '❤️', senderTimestampMs: 1700000000000 }
    }
    await service.processReaction(update, null)

    expect(reactionRepository.upsertReaction).toHaveBeenCalledWith('target-2', 55, '❤️', expect.any(BigInt))
    expect(busEmit).toHaveBeenCalledWith('reaction:processed', expect.objectContaining({ senderId: 55 }))
  })
})
