import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageService } from '../../services/messages/MessageService'

describe('MessageService - Querying', () => {
  let service: MessageService
  let contactService: any
  let chatRepository: any
  let queryRepository: any
  let reactionRepository: any
  let enricher: any

  beforeEach(() => {
    contactService = {
      resolveLidFromJid: vi.fn().mockResolvedValue('chat@s.whatsapp.net'),
      batchResolveNames: vi.fn().mockResolvedValue(new Map()),
    }
    chatRepository = {}
    queryRepository = {
      findChatMessagesWithSender: vi.fn().mockResolvedValue([{ id: 'msg1', content: '{}' }]),
    }
    reactionRepository = {
      findReactionsForMessages: vi.fn().mockResolvedValue([]),
    }
    enricher = {
      enrichMessage: vi.fn().mockResolvedValue({ id: 'msg1', textContent: 'hello' }),
      enrichReactions: vi.fn().mockReturnValue([]),
    }

    service = new MessageService(
      contactService,
      chatRepository,
      {} as any,
      {} as any,
      () => null,
      {} as any,
      {} as any,
      queryRepository,
      reactionRepository,
      enricher,
      {} as any,
      []
    )
  })

  it('getChatMessages returns enriched messages', async () => {
    const res = await service.getChatMessages('chat@s.whatsapp.net')
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('msg1')
    expect(queryRepository.findChatMessagesWithSender).toHaveBeenCalled()
  })

  describe('getChatMessagesPage (F-UC-1)', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    beforeEach(() => {
      queryRepository.findChatMessagesByCursor = vi.fn().mockResolvedValue(rows)
      enricher.enrichMessage.mockImplementation(async (m: { id: string }) => ({ id: m.id }))
    })

    it("'before' fetches the cursor page and returns it oldest -> newest", async () => {
      const res = await service.getChatMessagesPage('j', { before: 'x', limit: 3 })
      expect(queryRepository.findChatMessagesByCursor).toHaveBeenCalledWith('j', 'before', 'x', 3)
      expect(res.map(m => m.id)).toEqual(['c', 'b', 'a'])
    })

    it("'after' keeps the repository (ascending) order", async () => {
      const res = await service.getChatMessagesPage('j', { after: 'x' })
      expect(queryRepository.findChatMessagesByCursor).toHaveBeenCalledWith('j', 'after', 'x', 50)
      expect(res.map(m => m.id)).toEqual(['a', 'b', 'c'])
    })

    it('no cursor returns the newest page and clamps limit to 1..200', async () => {
      await service.getChatMessagesPage('j', { limit: 9999 })
      expect(queryRepository.findChatMessagesWithSender).toHaveBeenLastCalledWith('j', 0, 200)
      await service.getChatMessagesPage('j', { limit: -4 })
      expect(queryRepository.findChatMessagesWithSender).toHaveBeenLastCalledWith('j', 0, 1)
    })
  })
})
