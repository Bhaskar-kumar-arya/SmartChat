import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageEnricher } from '../../services/messages/MessageEnricher'
import { IContactQueryService, IContactNameResolver } from '../../services/contacts/IContactService'
import { ICallQueryService } from '../../services/calls/ICallService'
import { DBMessageWithSender } from '../../domain/db.types'

describe('MessageEnricher', () => {
  let enricher: MessageEnricher
  let contactService: import('vitest').Mocked<IContactQueryService & IContactNameResolver>
  let callService: import('vitest').Mocked<ICallQueryService>

  beforeEach(() => {
    contactService = {
      getMeJids: vi.fn().mockResolvedValue(['me@s.whatsapp.net']),
      batchResolveNames: vi.fn().mockResolvedValue(new Map()),
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

  // Smoke 2026-10-06: a mention on an incoming attachment showed the raw @number until the chat
  // was reopened, because live callers only put the sender in nameMap.
  it('resolves mentioned JIDs that are missing from the supplied nameMap', async () => {
    contactService.batchResolveNames.mockResolvedValue(new Map([['187273727488097@lid', 'Yashash']]))
    const rawMsg = {
      id: 'doc1',
      chatJid: 'g@g.us',
      fromMe: false,
      participant: 'user@s.whatsapp.net',
      timestamp: 1000n,
      messageType: 'documentMessage',
      textContent: '@187273727488097 hi',
      content: JSON.stringify({
        documentMessage: {
          caption: '@187273727488097 hi',
          contextInfo: { mentionedJid: ['187273727488097@lid'] }
        }
      }),
      isDeleted: false,
      isEdited: false,
      status: 'RECEIVED'
    } as unknown as DBMessageWithSender

    const res = await enricher.enrichMessage(rawMsg, null, new Map([['user@s.whatsapp.net', 'Alice']]))

    expect(contactService.batchResolveNames).toHaveBeenCalledWith(['187273727488097@lid'], null)
    expect(JSON.parse(res.content).documentMessage.contextInfo.mentions).toEqual({
      '187273727488097@lid': 'Yashash'
    })
  })

  it('does not re-resolve mentioned JIDs the nameMap already has', async () => {
    const rawMsg = {
      id: 'm2', chatJid: 'g@g.us', fromMe: false, participant: 'user@s.whatsapp.net', timestamp: 1000n,
      messageType: 'extendedTextMessage', textContent: '@1 hi',
      content: JSON.stringify({ extendedTextMessage: { text: '@1 hi', contextInfo: { mentionedJid: ['1@lid'] } } }),
      isDeleted: false, isEdited: false, status: 'RECEIVED'
    } as unknown as DBMessageWithSender

    await enricher.enrichMessage(rawMsg, null, new Map([['1@lid', 'One']]))

    expect(contactService.batchResolveNames).not.toHaveBeenCalled()
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

  it('enriches DM self-reply contextInfo participantName as "You" when ctx.participant is omitted', async () => {
    const rawMsg: DBMessageWithSender = {
      id: 'reply1',
      chatJid: 'user2@s.whatsapp.net',
      fromMe: true,
      participant: null,
      timestamp: 2000n,
      messageType: 'extendedTextMessage',
      textContent: 'Replying to myself',
      content: JSON.stringify({
        extendedTextMessage: {
          text: 'Replying to myself',
          contextInfo: {
            stanzaId: 'original_self_msg_1',
            quotedMessage: { conversation: 'Original message I sent' }
            // Note: participant is omitted here by Baileys in 1-on-1 DM self-replies
          }
        }
      }),
      isDeleted: false,
      isEdited: false,
      status: 'SENT'
    } as any

    const nameMap = new Map()
    const res = await enricher.enrichMessage(rawMsg, null, nameMap)
    const parsedContent = JSON.parse(res.content)
    
    expect(parsedContent.extendedTextMessage.contextInfo.participantName).toBe('You')
  })
})

