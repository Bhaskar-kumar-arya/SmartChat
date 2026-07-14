import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatActionService } from '../../services/chats/ChatActionService'
import { IChatMutationService } from '../../services/chats/IChatService'

describe('ChatActionService', () => {
  let service: ChatActionService
  let chatMutation: import('vitest').Mocked<IChatMutationService>
  let mockSock: any

  beforeEach(() => {
    chatMutation = {
      upsertChat: vi.fn(),
      markRead: vi.fn(),
      incrementUnread: vi.fn(),
      updateTimestamp: vi.fn(),
    } as any

    mockSock = {
      chatModify: vi.fn(),
    }

    service = new ChatActionService(chatMutation)
  })

  it('muteChat calls sock.chatModify', async () => {
    mockSock.chatModify.mockResolvedValue(undefined)
    const res = await service.muteChat(mockSock, 'test@s.whatsapp.net', 8 * 3600 * 1000)
    expect(res.success).toBe(true)
    expect(mockSock.chatModify).toHaveBeenCalledWith({ mute: 8 * 3600 * 1000 }, 'test@s.whatsapp.net')
  })

  it('pinChat calls sock.chatModify', async () => {
    mockSock.chatModify.mockResolvedValue(undefined)
    const res = await service.pinChat(mockSock, 'test@s.whatsapp.net', true)
    expect(res.success).toBe(true)
    expect(mockSock.chatModify).toHaveBeenCalledWith({ pin: true }, 'test@s.whatsapp.net')
  })

  it('markChatRead calls markRead locally if read=true', async () => {
    chatMutation.markRead.mockResolvedValue(true)
    const res = await service.markChatRead(mockSock, 'test@s.whatsapp.net', true)
    expect(res.success).toBe(true)
    expect(chatMutation.markRead).toHaveBeenCalledWith('test@s.whatsapp.net')
  })

  it('archiveChat calls upsertChat locally', async () => {
    chatMutation.upsertChat.mockResolvedValue(undefined)
    const res = await service.archiveChat(mockSock, 'test@s.whatsapp.net', true)
    expect(res.success).toBe(true)
    expect(chatMutation.upsertChat).toHaveBeenCalledWith('test@s.whatsapp.net', { archived: true })
  })
})
