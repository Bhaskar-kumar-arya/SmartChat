import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageService } from '../../services/messages/MessageService'
import { MessageParser } from '../../services/messages/MessageParser'

describe('MessageService - Processing', () => {
  let service: MessageService
  let contactService: any
  let chatRepository: any
  let embeddingService: any
  let secretMessageService: any
  let getBus: any
  let parser: MessageParser
  let repository: any
  let queryRepository: any
  let reactionRepository: any
  let enricher: any
  let identityResolver: any
  let processors: any[]

  beforeEach(() => {
    contactService = {}
    chatRepository = { upsertChat: vi.fn().mockResolvedValue({}) }
    embeddingService = {}
    secretMessageService = {}
    getBus = vi.fn().mockReturnValue({ emit: vi.fn() })
    parser = new MessageParser()
    repository = { revokeMessage: vi.fn() }
    queryRepository = {}
    reactionRepository = {}
    enricher = {}
    identityResolver = {
      resolveSenderJid: vi.fn().mockResolvedValue('sender@s.whatsapp.net'),
      upsertContactPushName: vi.fn().mockResolvedValue(undefined),
      reconcileLidPnFromJids: vi.fn().mockResolvedValue(undefined),
      resolveSenderId: vi.fn().mockResolvedValue(1),
    }
    processors = [
      {
        requiresChat: false,
        supports: vi.fn().mockReturnValue(true),
        process: vi.fn().mockResolvedValue({ id: 'msg1' })
      }
    ]

    service = new MessageService(
      contactService,
      chatRepository,
      embeddingService,
      secretMessageService,
      getBus,
      parser,
      repository,
      queryRepository,
      reactionRepository,
      enricher,
      identityResolver,
      processors
    )
  })

  it('processMessage dispatches to processor correctly', async () => {
    const msg = {
      key: { id: 'msg1', remoteJid: 'chat@s.whatsapp.net' },
      message: { conversation: 'Hello' }
    }
    const res = await service.processMessage(msg, {} as any)
    expect(res).toEqual({ id: 'msg1' })
    expect(processors[0].process).toHaveBeenCalled()
  })

  it('revokeMessageInDb calls repository correctly', async () => {
    await service.revokeMessageInDb('msg1')
    expect(repository.revokeMessage).toHaveBeenCalledWith('msg1')
  })
})
