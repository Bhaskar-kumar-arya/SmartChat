import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatService } from '../../services/chats/ChatService'
import { IChatRepository } from '../../services/chats/IChatRepository'
import { ICommunityRepository } from '../../services/chats/ICommunityRepository'
import { IContactNameResolver } from '../../services/contacts/IContactService'
import { IGroupMembershipService } from '../../services/chats/IGroupMembershipService'
import { IChatListEnricher } from '../../services/chats/IChatListEnricher'

describe('ChatService', () => {
  let service: ChatService
  let chatRepo: import('vitest').Mocked<IChatRepository>
  let communityRepo: import('vitest').Mocked<ICommunityRepository>
  let nameResolver: import('vitest').Mocked<IContactNameResolver>
  let groupMembership: import('vitest').Mocked<IGroupMembershipService>
  let chatListEnricher: import('vitest').Mocked<IChatListEnricher>
  let sockAccessor: any

  beforeEach(() => {
    chatRepo = {
      upsertChat: vi.fn(),
      updateChatUnreadCount: vi.fn(),
      findChatMuteExpiration: vi.fn(),
      incrementUnread: vi.fn(),
      updateTimestamp: vi.fn(),
    } as any

    communityRepo = {
      upsertCommunity: vi.fn(),
      updateCommunityAnnounceJid: vi.fn(),
    } as any

    nameResolver = {
      batchResolveNames: vi.fn(),
      resolveName: vi.fn(),
    } as any

    groupMembership = {
      linkGroupMetadataOwners: vi.fn(),
      syncGroupMembers: vi.fn(),
    } as any

    chatListEnricher = {
      getChatList: vi.fn(),
      getChatByJid: vi.fn(),
    } as any

    sockAccessor = vi.fn().mockReturnValue(null)

    service = new ChatService(chatRepo, communityRepo, nameResolver, groupMembership, chatListEnricher, sockAccessor)
  })

  it('upsertChat basic fields', async () => {
    await service.upsertChat('test@s.whatsapp.net', {
      name: 'Test Chat',
    })

    expect(chatRepo.upsertChat).toHaveBeenCalledWith('test@s.whatsapp.net', expect.objectContaining({
      name: 'Test Chat'
    }))
  })

  it('S4-04: upsertChat persists a concrete non-zero unreadCount (marked-unread from another device)', async () => {
    await service.upsertChat('test@s.whatsapp.net', { unreadCount: 5 })
    expect(chatRepo.upsertChat).toHaveBeenCalledWith('test@s.whatsapp.net', expect.objectContaining({
      unreadCount: 5
    }))
  })

  it('S4-04: upsertChat ignores the WhatsApp "unknown" sentinel (-1)', async () => {
    await service.upsertChat('test@s.whatsapp.net', { unreadCount: -1, name: 'X' })
    const arg = chatRepo.upsertChat.mock.calls[0][1] as Record<string, unknown>
    expect(arg).not.toHaveProperty('unreadCount')
  })

  it('markRead updates unread count to 0', async () => {
    chatRepo.updateChatUnreadCount.mockResolvedValue({} as any)
    const result = await service.markRead('test@s.whatsapp.net')
    expect(result).toBe(true)
    expect(chatRepo.updateChatUnreadCount).toHaveBeenCalledWith('test@s.whatsapp.net', 0)
  })

  it('isChatMuted returns true if expiration is in the future', async () => {
    chatRepo.findChatMuteExpiration.mockResolvedValue({ muteExpiration: BigInt(Math.floor(Date.now() / 1000) + 100000) } as any)
    const result = await service.isChatMuted('test@s.whatsapp.net')
    expect(result).toBe(true)
  })
})
