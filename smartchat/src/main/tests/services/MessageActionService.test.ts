import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageActionService } from '../../services/messages/MessageActionService'

describe('MessageActionService', () => {
  let service: MessageActionService
  let repo: any
  let reactionRepo: any
  let queryRepo: any
  let identRepo: any
  let contactService: any
  let processService: any
  let queryService: any
  let chatService: any
  let senderService: any
  let sock: any

  beforeEach(() => {
    repo = { updateMessageDeleted: vi.fn().mockResolvedValue(undefined) }
    reactionRepo = {}
    queryRepo = {
      findMessageById: vi.fn().mockResolvedValue({ id: 'msg1', chatJid: 'chat@s.whatsapp.net', fromMe: true }),
    }
    identRepo = {}
    contactService = { resolveLidFromJid: vi.fn().mockResolvedValue('chat@s.whatsapp.net') }
    processService = {}
    queryService = {}
    chatService = {}
    senderService = {}
    sock = { sendMessage: vi.fn().mockResolvedValue({}) }

    service = new MessageActionService(
      repo, reactionRepo, queryRepo, identRepo, contactService, processService, queryService, chatService, () => null, senderService
    )
  })

  it('deleteMessage invokes sock.sendMessage with delete key', async () => {
    const res = await service.deleteMessage(sock, 'msg1')
    expect(res.success).toBe(true)
    expect(sock.sendMessage).toHaveBeenCalledWith('chat@s.whatsapp.net', {
      delete: { id: 'msg1', fromMe: true, remoteJid: 'chat@s.whatsapp.net', participant: undefined }
    })
    expect(repo.updateMessageDeleted).toHaveBeenCalledWith('msg1')
  })

  describe('forwardMessage partial failure (S2-06)', () => {
    beforeEach(() => {
      queryRepo.findMessageById = vi.fn().mockResolvedValue({
        id: 'src', chatJid: 'src@s.whatsapp.net', fromMe: false, participant: null, timestamp: 1n, content: '{}'
      })
      contactService.resolveLidFromJid = vi.fn().mockImplementation((j: string) => Promise.resolve(j))
      contactService.batchResolveNames = vi.fn().mockResolvedValue({})
      chatService.updateTimestamp = vi.fn().mockResolvedValue(undefined)
      processService.processMessage = vi.fn().mockResolvedValue({
        id: 'fwd', chatJid: 'x', fromMe: true, participant: null, timestamp: 1n, textContent: null, messageType: 'conversation'
      })
      queryService.enrichMessage = vi.fn().mockResolvedValue({ chatJid: 'x', messageType: 'conversation', fromMe: true, timestamp: 1 })
    })

    it('does not abort the loop when one destination fails and reports partial success', async () => {
      sock.sendMessage = vi.fn()
        .mockResolvedValueOnce({ key: { id: 'fwd' } })
        .mockRejectedValueOnce(new Error('blocked'))
        .mockResolvedValueOnce({ key: { id: 'fwd' } })

      const res = await service.forwardMessage(sock, 'src', ['a@s.whatsapp.net', 'b@s.whatsapp.net', 'c@s.whatsapp.net'])

      expect(res.success).toBe(false)
      expect(res.results).toHaveLength(2)
      expect(res.failures).toEqual([{ jid: 'b@s.whatsapp.net', error: 'blocked' }])
      expect(sock.sendMessage).toHaveBeenCalledTimes(3)
    })

    it('throws only when every destination fails', async () => {
      sock.sendMessage = vi.fn().mockRejectedValue(new Error('offline'))
      await expect(
        service.forwardMessage(sock, 'src', ['a@s.whatsapp.net', 'b@s.whatsapp.net'])
      ).rejects.toThrow(/any of 2 destination/)
    })
  })
})
