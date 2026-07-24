import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageSenderService } from '../../services/messages/MessageSenderService'
import { LocalFileStorage } from '../../services/storage/LocalFileStorage'

describe('MessageSenderService', () => {
  let service: MessageSenderService
  let messageRepo: any
  let messageQueryRepo: any
  let contactService: any
  let processingService: any
  let parserService: any
  let queryService: any
  let chatService: any
  let sock: any
  let getBus: any
  let storage: any

  beforeEach(() => {
    messageRepo = { upsertMessage: vi.fn().mockResolvedValue(undefined) }
    messageQueryRepo = { findMessageById: vi.fn().mockResolvedValue(null) }
    contactService = {
      resolveLidFromJid: vi.fn().mockResolvedValue('target@s.whatsapp.net'),
      batchResolveNames: vi.fn().mockResolvedValue(new Map()),
      getMeJids: vi.fn().mockResolvedValue([]),
    }
    processingService = { processMessage: vi.fn().mockResolvedValue({ id: 'sent1' }) }
    parserService = {}
    queryService = { enrichMessage: vi.fn().mockResolvedValue({ id: 'sent1', chatJid: 'target@s.whatsapp.net', timestamp: 1000n }) }
    chatService = { updateTimestamp: vi.fn().mockResolvedValue(undefined) }
    sock = { sendMessage: vi.fn().mockResolvedValue({ key: { id: 'sent1' } }) }
    getBus = vi.fn().mockReturnValue({ emit: vi.fn().mockResolvedValue(undefined) })
    storage = new LocalFileStorage()

    service = new MessageSenderService(
      messageRepo,
      messageQueryRepo,
      contactService,
      processingService,
      parserService,
      queryService,
      chatService,
      getBus,
      storage
    )
  })

  it('sendMessageWorkflow sends text message correctly', async () => {
    const res = await service.sendMessageWorkflow(sock, 'target@s.whatsapp.net', 'Hello')
    expect(res.id).toBe('sent1')
    expect(sock.sendMessage).toHaveBeenCalledWith(
      'target@s.whatsapp.net',
      { text: 'Hello' },
      expect.any(Object)
    )
  })

  describe('Reply Context (buildQuotedContextInfo)', () => {
    it('preserves reply context when quoting another user in a DM', async () => {
      contactService.resolveLidFromJid.mockImplementation(async (j: string) => j)
      messageQueryRepo.findMessageById.mockResolvedValue({
        id: 'other_msg_1',
        fromMe: false,
        participant: null,
        content: JSON.stringify({ conversation: 'Hello from sender' })
      })

      await service.sendMessageWorkflow(
        sock,
        'user2@s.whatsapp.net',
        'Replying to you',
        'other_msg_1'
      )

      expect(sock.sendMessage).toHaveBeenCalledWith(
        'user2@s.whatsapp.net',
        expect.objectContaining({
          text: 'Replying to you',
          contextInfo: expect.objectContaining({
            stanzaId: 'other_msg_1',
            participant: 'user2@s.whatsapp.net',
            quotedMessage: expect.anything()
          })
        }),
        expect.any(Object)
      )
    })

    it('preserves reply context when quoting another user in a Group', async () => {
      contactService.resolveLidFromJid.mockResolvedValue('123456@g.us')
      messageQueryRepo.findMessageById.mockResolvedValue({
        id: 'group_msg_1',
        fromMe: false,
        participant: 'member1@s.whatsapp.net',
        content: JSON.stringify({ conversation: 'Group message from member' })
      })

      await service.sendMessageWorkflow(
        sock,
        '123456@g.us',
        'Replying to group member',
        'group_msg_1'
      )

      expect(sock.sendMessage).toHaveBeenCalledWith(
        '123456@g.us',
        expect.objectContaining({
          text: 'Replying to group member',
          contextInfo: expect.objectContaining({
            stanzaId: 'group_msg_1',
            participant: 'member1@s.whatsapp.net',
            quotedMessage: expect.anything()
          })
        }),
        expect.any(Object)
      )
    })

    it('preserves reply context when quoting a self-sent message with sock.user present', async () => {
      contactService.resolveLidFromJid.mockImplementation(async (j: string) => j)
      sock.user = { id: 'me@s.whatsapp.net', lid: 'me@lid' }
      messageQueryRepo.findMessageById.mockResolvedValue({
        id: 'self_msg_1',
        fromMe: true,
        content: JSON.stringify({ conversation: 'Original self message' })
      })

      await service.sendMessageWorkflow(
        sock,
        'user2@s.whatsapp.net',
        'Replying to self',
        'self_msg_1'
      )

      expect(sock.sendMessage).toHaveBeenCalledWith(
        'user2@s.whatsapp.net',
        expect.objectContaining({
          text: 'Replying to self',
          contextInfo: expect.objectContaining({
            stanzaId: 'self_msg_1',
            participant: 'me@s.whatsapp.net',
            quotedMessage: expect.anything()
          })
        }),
        expect.any(Object)
      )
    })

    it('preserves reply context when quoting a self-sent message even if sock.user is missing', async () => {
      sock.user = undefined
      messageQueryRepo.findMessageById.mockResolvedValue({
        id: 'self_msg_2',
        fromMe: true,
        content: JSON.stringify({ conversation: 'Original self message' })
      })

      await service.sendMessageWorkflow(
        sock,
        'target@s.whatsapp.net',
        'Replying to self',
        'self_msg_2'
      )

      expect(sock.sendMessage).toHaveBeenCalledWith(
        'target@s.whatsapp.net',
        expect.objectContaining({
          text: 'Replying to self',
          contextInfo: expect.objectContaining({
            stanzaId: 'self_msg_2',
            quotedMessage: expect.anything()
          })
        }),
        expect.any(Object)
      )
    })
  })
})
