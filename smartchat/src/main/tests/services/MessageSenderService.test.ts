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

  describe('mentions in the stored optimistic message', () => {
    // Smoke 2026-10-06: after sending an @mention the bubble/preview showed the raw
    // number until the chat was reopened. The stored content carried Baileys' send option
    // `mentions` instead of the wire field contextInfo.mentionedJid that the enricher reads.
    it('stores mentioned JIDs as contextInfo.mentionedJid', async () => {
      await service.sendMessageWorkflow(sock, 'group@g.us', 'hi @1234', undefined, ['1234@s.whatsapp.net'])

      const pending = messageRepo.upsertMessage.mock.calls[0][0]
      const stored = JSON.parse(pending.content)
      expect(stored.extendedTextMessage.contextInfo.mentionedJid).toEqual(['1234@s.whatsapp.net'])
    })

    it('keeps quote context and mentions together', async () => {
      messageQueryRepo.findMessageById.mockResolvedValue({
        id: 'q1', fromMe: false, participant: null,
        content: JSON.stringify({ conversation: 'quoted' })
      })
      await service.sendMessageWorkflow(sock, 'user2@s.whatsapp.net', 'hi @1234', 'q1', ['1234@s.whatsapp.net'])

      const stored = JSON.parse(messageRepo.upsertMessage.mock.calls[0][0].content)
      expect(stored.extendedTextMessage.contextInfo).toEqual(
        expect.objectContaining({ stanzaId: 'q1', mentionedJid: ['1234@s.whatsapp.net'] })
      )
    })
  })

  describe('mentions in a media caption (stored optimistic message)', () => {
    it('stores mentioned JIDs as contextInfo.mentionedJid on the media payload', async () => {
      await service.sendMediaMessageWorkflow(
        sock, 'group@g.us', 'does-not-exist.jpg', 'look @1234', undefined, ['1234@s.whatsapp.net']
      )

      const pending = messageRepo.upsertMessage.mock.calls[0][0]
      const stored = JSON.parse(pending.content)
      expect(stored.imageMessage.contextInfo.mentionedJid).toEqual(['1234@s.whatsapp.net'])
    })
  })

  describe('send failure → FAILED status (S2-02)', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0))

    it('marks the optimistic message FAILED and emits status-updated when the background send rejects', async () => {
      sock.sendMessage = vi.fn().mockRejectedValue(new Error('socket offline'))

      const enriched = await service.sendMessageWorkflow(sock, 'target@s.whatsapp.net', 'Hello')
      // optimistic PENDING row returned to caller immediately
      expect(enriched.id).toBeDefined()

      await flush()
      await flush()

      const failedUpsert = messageRepo.upsertMessage.mock.calls
        .map((c: any[]) => c[0])
        .find((m: any) => m.status === 'FAILED')
      expect(failedUpsert).toBeDefined()

      expect(getBus().emit).toHaveBeenCalledWith(
        'message:status-updated',
        expect.objectContaining({ status: 'FAILED', chatJid: 'target@s.whatsapp.net' })
      )
    })
  })

  describe('retryFailedMessage', () => {
    const failed = (over: Record<string, unknown>) => ({
      id: 'old1', chatJid: 'target@s.whatsapp.net', fromMe: true, status: 'FAILED', isDeleted: false, ...over
    })
    beforeEach(() => {
      messageRepo.deleteLocalMessage = vi.fn().mockResolvedValue(undefined)
    })

    it.fails('re-sends a failed text with its quote and mentions, then removes the failed row', async () => {
      messageQueryRepo.findMessageById.mockResolvedValue(failed({
        messageType: 'extendedTextMessage',
        textContent: 'hi @1234',
        content: JSON.stringify({ extendedTextMessage: { text: 'hi @1234', contextInfo: { stanzaId: 'q1', mentionedJid: ['1234@s.whatsapp.net'] } } })
      }))
      const spy = vi.spyOn(service, 'sendMessageWorkflow')

      const res = await service.retryFailedMessage(sock, 'target@s.whatsapp.net', 'old1')

      expect(spy).toHaveBeenCalledWith(sock, 'target@s.whatsapp.net', 'hi @1234', 'q1', ['1234@s.whatsapp.net'])
      expect(messageRepo.deleteLocalMessage).toHaveBeenCalledWith('old1')
      expect(res.id).toBe('sent1')
    })

    it.fails('re-sends a failed plain text', async () => {
      messageQueryRepo.findMessageById.mockResolvedValue(failed({
        messageType: 'conversation', textContent: 'Hello', content: JSON.stringify({ conversation: 'Hello' })
      }))
      const spy = vi.spyOn(service, 'sendMessageWorkflow')
      await service.retryFailedMessage(sock, 'target@s.whatsapp.net', 'old1')
      expect(spy).toHaveBeenCalledWith(sock, 'target@s.whatsapp.net', 'Hello', undefined, undefined)
    })

    it.fails('re-sends a failed media message from its cached copy with the caption', async () => {
      messageQueryRepo.findMessageById.mockResolvedValue(failed({
        messageType: 'imageMessage',
        textContent: 'look',
        content: JSON.stringify({ imageMessage: { localURI: 'app://media/old1.jpg', caption: 'look' } })
      }))
      const spy = vi.spyOn(service, 'sendMediaMessageWorkflow')
      await service.retryFailedMessage(sock, 'target@s.whatsapp.net', 'old1')
      expect(spy).toHaveBeenCalledWith(sock, 'target@s.whatsapp.net', 'app://media/old1.jpg', 'look', undefined, undefined)
      expect(messageRepo.deleteLocalMessage).toHaveBeenCalledWith('old1')
    })

    it.fails('keeps the failed row when the new send throws', async () => {
      messageQueryRepo.findMessageById.mockResolvedValue(failed({
        messageType: 'conversation', textContent: 'Hello', content: JSON.stringify({ conversation: 'Hello' })
      }))
      vi.spyOn(service, 'sendMessageWorkflow').mockRejectedValue(new Error('boom'))
      await expect(service.retryFailedMessage(sock, 'target@s.whatsapp.net', 'old1')).rejects.toThrow('boom')
      expect(messageRepo.deleteLocalMessage).not.toHaveBeenCalled()
    })

    it.each([
      ['not found', null],
      ['not mine', failed({ fromMe: false })],
      ['not FAILED', failed({ status: 'SENT' })]
    ])('refuses to retry a message that is %s', async (_label, row) => {
      messageQueryRepo.findMessageById.mockResolvedValue(row)
      const spy = vi.spyOn(service, 'sendMessageWorkflow')
      await expect(service.retryFailedMessage(sock, 'target@s.whatsapp.net', 'old1')).rejects.toThrow()
      expect(spy).not.toHaveBeenCalled()
    })
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
