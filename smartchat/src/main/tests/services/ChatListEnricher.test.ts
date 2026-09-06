import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatListEnricher } from '../../services/chats/ChatListEnricher'
import { IChatRepository } from '../../services/chats/IChatRepository'
import { IReactionRepository } from '../../services/messages/IReactionRepository'
import { IMessageSearchRepository } from '../../services/messages/IMessageSearchRepository'
import { IContactQueryService } from '../../services/contacts/IContactService'
import { MessageFormatterRegistry } from '../../services/messages/formatters/MessageFormatterRegistry'

describe('ChatListEnricher', () => {
  let enricher: ChatListEnricher
  let chatRepo: import('vitest').Mocked<IChatRepository>
  let messageRepo: import('vitest').Mocked<IMessageSearchRepository>
  let reactionRepo: import('vitest').Mocked<IReactionRepository>
  let contactService: import('vitest').Mocked<IContactQueryService>
  let formatterRegistry: import('vitest').Mocked<MessageFormatterRegistry>

  beforeEach(() => {
    chatRepo = {
      findChatsPaginated: vi.fn(),
      findChatsByCommunityJids: vi.fn(),
      findChatsByJidsWithCommunity: vi.fn(),
    } as any

    messageRepo = {
      findLastMessage: vi.fn(),
    } as any

    reactionRepo = {
      findLastReaction: vi.fn(),
    } as any

    contactService = {
      getIdentityIdByJid: vi.fn(),
      findIdentityById: vi.fn(),
    } as any

    formatterRegistry = {
      format: vi.fn().mockReturnValue('Formatted Message'),
    } as any

    enricher = new ChatListEnricher(chatRepo, messageRepo, reactionRepo, contactService, formatterRegistry)
  })

  it('S4-02: injected community siblings are flagged outOfWindow, page rows are not', async () => {
    chatRepo.findChatsPaginated.mockResolvedValue([
      { jid: 'sub1@g.us', type: 'GROUP', unreadCount: 0, muteExpiration: 0n, community: { jid: 'comm@g.us' } } as any
    ])
    chatRepo.findChatsByCommunityJids.mockResolvedValue([
      { jid: 'sub1@g.us', type: 'GROUP', unreadCount: 0, muteExpiration: 0n, community: { jid: 'comm@g.us' } } as any,
      { jid: 'comm@g.us', type: 'COMMUNITY', unreadCount: 0, muteExpiration: 0n } as any,
      { jid: 'sub2@g.us', type: 'GROUP', unreadCount: 0, muteExpiration: 0n, community: { jid: 'comm@g.us' } } as any
    ])
    messageRepo.findLastMessage.mockResolvedValue(null)
    reactionRepo.findLastReaction.mockResolvedValue(null)

    const res = await enricher.getChatList(1, 50)

    const byJid = Object.fromEntries(res.map(r => [r.jid, r]))
    expect(byJid['sub1@g.us'].outOfWindow).toBeFalsy()   // on the page
    expect(byJid['comm@g.us'].outOfWindow).toBe(true)     // pulled in for grouping
    expect(byJid['sub2@g.us'].outOfWindow).toBe(true)
    // sub1 is not duplicated by the community fetch
    expect(res.filter(r => r.jid === 'sub1@g.us')).toHaveLength(1)
  })

  it('getChatByJid returns null if chat not found', async () => {
    chatRepo.findChatsByJidsWithCommunity.mockResolvedValue([])
    const res = await enricher.getChatByJid('test@s.whatsapp.net')
    expect(res).toBeNull()
  })

  it('getChatByJid returns enriched chat', async () => {
    chatRepo.findChatsByJidsWithCommunity.mockResolvedValue([{
      jid: 'test@s.whatsapp.net',
      type: 'DM',
      unreadCount: 0,
      muteExpiration: BigInt(0),
    } as any])

    messageRepo.findLastMessage.mockResolvedValue({
      id: 'msg1',
      timestamp: BigInt(1000),
      textContent: 'Hello',
      messageType: 'conversation',
      fromMe: true,
    } as any)

    reactionRepo.findLastReaction.mockResolvedValue(null)
    contactService.getIdentityIdByJid.mockResolvedValue(1)
    contactService.findIdentityById.mockResolvedValue({ displayName: 'Alice' } as any)

    const res = await enricher.getChatByJid('test@s.whatsapp.net')
    expect(res).toBeDefined()
    expect(res?.name).toBe('Alice')
    expect(res?.lastMessage).toBe('Formatted Message')
    expect(res?.lastMessageFromMe).toBe(true)
  })
})
