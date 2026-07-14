import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageEnricher } from '../../services/messages/MessageEnricher'
import { IContactQueryService } from '../../services/contacts/IContactService'
import { ICallQueryService } from '../../services/calls/ICallService'
import { DBMessageWithSender } from '../../domain/db.types'

describe('MessageEnricher', () => {
  let enricher: MessageEnricher
  let contactService: import('vitest').Mocked<IContactQueryService>
  let callService: import('vitest').Mocked<ICallQueryService>

  beforeEach(() => {
    contactService = {
      getMeJids: vi.fn().mockResolvedValue(['me@s.whatsapp.net']),
    } as any

    callService = {
      getCallLog: vi.fn().mockResolvedValue(null),
    } as any

    enricher = new MessageEnricher(contactService, callService)
  })

  it('enriches a basic conversation message', async () => {
    const rawMsg: DBMessageWithSender = {
      id: 'msg1',
      chatJid: 'chat@s.whatsapp.net',
      fromMe: false,
      participant: 'user@s.whatsapp.net',
      timestamp: 1000n,
      messageType: 'conversation',
      textContent: 'Hello',
      content: JSON.stringify({ conversation: 'Hello' }),
      isDeleted: false,
      isEdited: false,
      status: 'RECEIVED'
    } as any

    const nameMap = new Map([['user@s.whatsapp.net', 'Alice']])
    const res = await enricher.enrichMessage(rawMsg, null, nameMap)
    
    expect(res.participantName).toBe('Alice')
    expect(res.timestamp).toBe('1000')
    expect(JSON.parse(res.content)).toEqual({ conversation: 'Hello' })
  })

  it('enriches reactions', () => {
    const reactions = [{
      messageId: 'msg1',
      text: '👍',
      timestamp: 1000n,
      senderId: 1,
      sender: { phoneNumber: 'user@s.whatsapp.net', displayName: 'Alice' }
    }]

    const res = enricher.enrichReactions(reactions)
    expect(res).toHaveLength(1)
    expect(res[0].text).toBe('👍')
    expect(res[0].senderName).toBe('Alice')
    expect(res[0].senderId).toBe('user@s.whatsapp.net')
    expect(res[0].timestamp).toBe('1000')
  })
})
