import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncChatsHandler } from '../../../services/sync/SyncChatsHandler'

/**
 * P2-S4-02 / P2-S4-03 regressions for the history-sync chats path.
 */
describe('SyncChatsHandler', () => {
  let chatRepository: any
  let communityRepository: any
  let contactService: any
  let handler: SyncChatsHandler

  beforeEach(() => {
    chatRepository = { upsertChat: vi.fn().mockResolvedValue(undefined) }
    communityRepository = {
      upsertCommunity: vi.fn().mockResolvedValue({ id: 1 }),
      updateCommunityAnnounceJid: vi.fn().mockResolvedValue(undefined)
    }
    contactService = { linkLidAndPn: vi.fn().mockResolvedValue(undefined) }
    handler = new SyncChatsHandler(chatRepository, communityRepository, contactService)
  })

  it('returns the count of chats actually upserted, skipping id-less entries (S4-03)', async () => {
    const chats = [
      { id: 'a@g.us' },
      { }, // id-less → skipped
      { id: 'b@s.whatsapp.net' }
    ] as any

    const count = await handler.processChats(chats, new Set())

    expect(count).toBe(2)
    expect(chatRepository.upsertChat).toHaveBeenCalledTimes(2)
  })

  it('normalizes a millisecond muteExpiration to seconds (S4-02)', async () => {
    const chats = [{ id: 'g@g.us', muteExpiration: 1_700_000_000_000 }] as any

    await handler.processChats(chats, new Set())

    expect(chatRepository.upsertChat).toHaveBeenCalledWith(
      'g@g.us',
      expect.objectContaining({ muteExpiration: 1_700_000_000n })
    )
  })
})
