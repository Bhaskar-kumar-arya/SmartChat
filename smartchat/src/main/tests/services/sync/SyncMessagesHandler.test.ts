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
    repository = { bulkSyncMessages: vi.fn().mockImplementation(async (rows: any[]) => rows) }
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

  // ── P2-S4-04: history-only chats must be seeded with a real timestamp ──
  it('seeds a message-only chat with the newest message timestamp, not {} (S4-04)', async () => {
    contactService.batchGetIdentityIds.mockResolvedValue(new Map())
    const messages = [
      { key: { id: 'x1', remoteJid: 'newchat@g.us', fromMe: true }, message: { conversation: 'a' }, messageTimestamp: 1700000000 },
      { key: { id: 'x2', remoteJid: 'newchat@g.us', fromMe: true }, message: { conversation: 'b' }, messageTimestamp: 1700009999 },
      { key: { id: 'x3', remoteJid: 'newchat@g.us', fromMe: true }, message: { conversation: 'c' }, messageTimestamp: 1700005000 }
    ] as any

    await handler.processMessages(messages, new Set(), null, null)

    const calls = chatRepository.upsertChat.mock.calls.filter((c: any[]) => c[0] === 'newchat@g.us')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ timestamp: 1700009999n })
  })

  // ── P2-S4-05: self identity resolved before parsing fromMe reactions ──
  it('resolves the self identity when meIdentityId is null so fromMe reactions are kept (S4-05)', async () => {
    contactService.batchGetIdentityIds.mockResolvedValue(new Map())
    contactService.getIdentityIdByJid.mockResolvedValue(77)
    repository.bulkSyncMessages.mockImplementation(async (rows: any[]) => rows)

    const reactionContent = JSON.stringify({ reactionMessage: { key: { id: 'target1' }, text: '🔥' } })
    const messages = [
      { key: { id: 'r1', remoteJid: 'me@s.whatsapp.net', fromMe: true }, message: JSON.parse(reactionContent), messageTimestamp: 1700000000 }
    ] as any

    await handler.processMessages(messages, new Set(['me@s.whatsapp.net']), 'me@s.whatsapp.net', null)

    expect(contactService.upsertContact).toHaveBeenCalledWith({ id: 'me@s.whatsapp.net' })
    const [pending] = reactionRepository.bulkSyncReactions.mock.calls[0]
    expect(pending).toEqual([
      expect.objectContaining({ targetId: 'target1', reactorId: 77, emoji: '🔥' })
    ])
  })

  // ── P2-S4-06: only genuinely-inserted rows are surfaced to the caller ──
  it('returns only newly-inserted rows in importedMessages (S4-06)', async () => {
    contactService.batchGetIdentityIds.mockResolvedValue(new Map())
    // repository reports only m2 as newly inserted
    repository.bulkSyncMessages.mockImplementation(async (rows: any[]) =>
      rows.filter((r) => r.id === 'm2')
    )
    const messages = [
      { key: { id: 'm1', remoteJid: 'grp@g.us', fromMe: true }, message: { conversation: 'a' }, messageTimestamp: 1700000000 },
      { key: { id: 'm2', remoteJid: 'grp@g.us', fromMe: true }, message: { conversation: 'b' }, messageTimestamp: 1700000001 }
    ] as any

    const res = await handler.processMessages(messages, new Set(['grp@g.us']), null, null)

    expect(res.importedMessages.map((m) => m.id)).toEqual(['m2'])
    // bulkSyncReactions called with a single argument now (no _currentBatchIds Set)
    expect(reactionRepository.bulkSyncReactions.mock.calls[0]).toHaveLength(1)
  })
})
