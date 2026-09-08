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
    chatRepo = {
      findChats: vi.fn().mockResolvedValue([]),
      searchChats: vi.fn().mockResolvedValue([])
    }
    msgSearchRepo = {
      findLastMessage: vi.fn().mockResolvedValue(null),
      findLastMessagesForChats: vi.fn().mockResolvedValue(new Map()),
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

  it('P2-S11-03: pushes name/jid match + LIMIT to SQL and batches last-message lookup', async () => {
    chatRepo.searchChats.mockResolvedValue([
      { jid: 'a@s.whatsapp.net', name: 'Alice', type: 'DM', profilePictureUrl: null },
      { jid: 'b@s.whatsapp.net', name: 'Bob', type: 'DM', profilePictureUrl: null }
    ])
    msgSearchRepo.findLastMessagesForChats.mockResolvedValue(
      new Map([['a@s.whatsapp.net', { textContent: 'hi', messageType: 'conversation', timestamp: 5n }]])
    )

    const res = await service.searchAll('al', 'normal', null, { jids: ['a@s.whatsapp.net', 'b@s.whatsapp.net'] })

    expect(chatRepo.searchChats).toHaveBeenCalledWith('al', 50, ['a@s.whatsapp.net', 'b@s.whatsapp.net'])
    expect(chatRepo.findChats).not.toHaveBeenCalled()
    // one batched call, not one findLastMessage per match
    expect(msgSearchRepo.findLastMessagesForChats).toHaveBeenCalledTimes(1)
    expect(msgSearchRepo.findLastMessage).not.toHaveBeenCalled()
    expect(res.chats).toHaveLength(2)
    expect(res.chats[0]).toMatchObject({ jid: 'a@s.whatsapp.net', lastMessage: 'hi' })
  })
})
