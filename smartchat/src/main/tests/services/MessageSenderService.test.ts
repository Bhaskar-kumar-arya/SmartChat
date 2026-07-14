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
})
