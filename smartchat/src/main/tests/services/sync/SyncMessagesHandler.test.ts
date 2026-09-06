import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncMessagesHandler } from '../../../services/sync/SyncMessagesHandler'

/**
 * S4-03: participant identity resolution for a history-sync batch must be
 * batched, not one sequential upsertContact + getIdentityIdByJid round-trip per
 * message.
 */
describe('SyncMessagesHandler (S4-03 batched identity resolution)', () => {
  let repository: any
  let reactionRepository: any
  let aliasRepository: any
  let chatRepository: any
  let contactService: any
  let handler: SyncMessagesHandler

  beforeEach(() => {
    repository = { bulkSyncMessages: vi.fn().mockResolvedValue(undefined) }
    reactionRepository = { bulkSyncReactions: vi.fn().mockResolvedValue(undefined) }
    aliasRepository = { findAllAliases: vi.fn().mockResolvedValue([]) }
    chatRepository = { upsertChat: vi.fn().mockResolvedValue(undefined) }
    contactService = {
      batchGetIdentityIds: vi.fn(),
      upsertContact: vi.fn().mockResolvedValue(undefined),
      getIdentityIdByJid: vi.fn().mockResolvedValue(null)
    }
    handler = new SyncMessagesHandler(
      repository,
      reactionRepository,
      aliasRepository,
      chatRepository,
      contactService
    )
  })

  const msg = (id: string, participant: string) => ({
    key: { id, remoteJid: 'grp@g.us', participant, fromMe: false },
    message: { conversation: 'hi' },
    messageTimestamp: 1700000000
  })

  it('resolves all distinct senders with batched queries, not per-message', async () => {
    // 4 messages from 2 distinct senders
    const messages = [
      msg('m1', '111@s.whatsapp.net'),
      msg('m2', '111@s.whatsapp.net'),
      msg('m3', '222@s.whatsapp.net'),
      msg('m4', '222@s.whatsapp.net')
    ] as any

    // First batched read: 111 already known, 222 missing → created then re-read
    contactService.batchGetIdentityIds
      .mockResolvedValueOnce(new Map([['111@s.whatsapp.net', 10]]))
      .mockResolvedValueOnce(new Map([['222@s.whatsapp.net', 20]]))

    const res = await handler.processMessages(messages, new Set(['grp@g.us']), null, null)

    expect(res.messageCount).toBe(4)
    // batched: 2 reads total (known + newly-created), regardless of message count
    expect(contactService.batchGetIdentityIds).toHaveBeenCalledTimes(2)
    // only the genuinely-new participant is upserted, exactly once
    expect(contactService.upsertContact).toHaveBeenCalledTimes(1)
    expect(contactService.upsertContact).toHaveBeenCalledWith({ id: '222@s.whatsapp.net' })
    // no per-message getIdentityIdByJid fallback needed
    expect(contactService.getIdentityIdByJid).not.toHaveBeenCalled()

    const [rows] = repository.bulkSyncMessages.mock.calls[0]
    expect(rows.map((r: any) => r.senderId)).toEqual([10, 10, 20, 20])
  })

  it('skips the create pass entirely when every sender is already known', async () => {
    const messages = [msg('m1', '111@s.whatsapp.net')] as any
    contactService.batchGetIdentityIds.mockResolvedValueOnce(new Map([['111@s.whatsapp.net', 10]]))

    await handler.processMessages(messages, new Set(['grp@g.us']), null, null)

    expect(contactService.batchGetIdentityIds).toHaveBeenCalledTimes(1)
    expect(contactService.upsertContact).not.toHaveBeenCalled()
  })
})
