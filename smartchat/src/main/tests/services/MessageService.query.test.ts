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
})
