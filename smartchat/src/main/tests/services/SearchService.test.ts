import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SearchService } from '../../services/search/SearchService'

describe('SearchService', () => {
  let service: SearchService
  let chatRepo: any
  let msgSearchRepo: any
  let msgVecRepo: any
  let identRepo: any
  let contactService: any
  let embeddingService: any

  beforeEach(() => {
    chatRepo = { findChats: vi.fn().mockResolvedValue([]) }
    msgSearchRepo = {
      findLastMessage: vi.fn().mockResolvedValue(null),
      findMessagesWithChatAndSender: vi.fn().mockResolvedValue([]),
    }
    msgVecRepo = {}
    identRepo = {}
    contactService = { batchResolveNames: vi.fn().mockResolvedValue(new Map()) }
    embeddingService = {}

    service = new SearchService(chatRepo, msgSearchRepo, msgVecRepo, identRepo, contactService, embeddingService)
  })

  it('searchAll returns empty results if query is empty', async () => {
    const res = await service.searchAll('', 'normal', null)
    expect(res.chats).toEqual([])
    expect(res.messages).toEqual([])
  })

  it('searchAll queries normal search', async () => {
    const res = await service.searchAll('hello', 'normal', null)
    expect(res.chats).toEqual([])
    expect(res.messages).toEqual([])
    expect(msgSearchRepo.findMessagesWithChatAndSender).toHaveBeenCalled()
  })
})
