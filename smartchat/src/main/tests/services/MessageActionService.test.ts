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
})
