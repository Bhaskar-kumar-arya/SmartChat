import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { MessageRepository } from '../../services/messages/MessageRepository'
import { MessageUpsertData } from '../../services/messages/IMessageRepository'
import { getPrismaClient } from '../helpers'

describe('MessageRepository', () => {
  let prisma: PrismaClient
  let repository: MessageRepository

  beforeAll(() => {
    prisma = getPrismaClient()
    repository = new MessageRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.reaction.deleteMany()
    await prisma.messageVector.deleteMany()
    await prisma.message.deleteMany()
    await prisma.chat.deleteMany()
  })

  const dummyChat = '123@g.us'

  it('should upsert a simple message', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })

    const msgData: MessageUpsertData = {
      id: 'msg1',
      chatJid: dummyChat,
      fromMe: true,
      timestamp: 100n,
      messageType: 'conversation',
      content: JSON.stringify({ conversation: 'hello' }),
      textContent: 'hello'
    }

    const res = await repository.upsertMessage(msgData)
    expect(res.textContent).toBe('hello')
    
    const dbMsg = await prisma.message.findUnique({ where: { id: 'msg1' } })
    expect(dbMsg?.textContent).toBe('hello')
  })

  it('should preserve localUri when upserting an existing media message', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })

    // Insert original message with a local URI
    const origContent = JSON.stringify({
      imageMessage: {
        url: 'https://wa.media/abc',
        localURI: 'file:///local/path/img.jpg'
      }
    })
    
    await prisma.message.create({
      data: {
        id: 'msg2',
        chatJid: dummyChat,
        fromMe: false,
        timestamp: 100n,
        messageType: 'imageMessage',
        content: origContent,
        textContent: 'a photo'
      }
    })

    // Upsert the same message, simulating a sync event where localURI is missing
    const newContent = JSON.stringify({
      imageMessage: {
        url: 'https://wa.media/abc'
      }
    })

    const msgData: MessageUpsertData = {
      id: 'msg2',
      chatJid: dummyChat,
      fromMe: false,
      timestamp: 100n,
      messageType: 'imageMessage',
      content: newContent,
      textContent: 'a photo'
    }

    const res = await repository.upsertMessage(msgData)
    const parsed = JSON.parse(res.content)
    
    // The localURI should be preserved
    expect(parsed.imageMessage.localURI).toBe('file:///local/path/img.jpg')
  })

  it('should edit a message and preserve contextInfo', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })

    const origContent = JSON.stringify({
      conversation: 'hello',
      messageContextInfo: { deviceListMetadata: { senderKeyHash: '123' } }
    })
    
    await prisma.message.create({
      data: {
        id: 'msg3',
        chatJid: dummyChat,
        fromMe: false,
        timestamp: 100n,
        messageType: 'conversation',
        content: origContent,
        textContent: 'hello'
      }
    })

    // Edit message
    await repository.editMessage('msg3', 'hello edited', {
      extendedTextMessage: { text: 'hello edited' }
    })

    const edited = await prisma.message.findUnique({ where: { id: 'msg3' } })
    expect(edited?.textContent).toBe('hello edited')
    expect(edited?.messageType).toBe('extendedTextMessage')
    expect(edited?.isEdited).toBe(true)

    // context info should be preserved
    const parsed = JSON.parse(edited?.content || '{}')
    expect(parsed.messageContextInfo?.deviceListMetadata?.senderKeyHash).toBe('123')
  })

  it('should edit a replied message and preserve quoted contextInfo', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } }).catch(() => {})

    const origContent = JSON.stringify({
      extendedTextMessage: {
        text: 'original reply',
        contextInfo: {
          stanzaId: 'orig_123',
          participant: 'alice@s.whatsapp.net',
          quotedMessage: { conversation: 'original question' }
        }
      }
    })

    await prisma.message.create({
      data: {
        id: 'msg4',
        chatJid: dummyChat,
        fromMe: true,
        timestamp: 200n,
        messageType: 'extendedTextMessage',
        content: origContent,
        textContent: 'original reply'
      }
    })

    // Protocol edit arrives with only conversation text (no contextInfo)
    await repository.editMessage('msg4', 'edited reply text', {
      conversation: 'edited reply text'
    })

    const edited = await prisma.message.findUnique({ where: { id: 'msg4' } })
    expect(edited?.textContent).toBe('edited reply text')
    expect(edited?.messageType).toBe('extendedTextMessage')
    expect(edited?.isEdited).toBe(true)

    const parsed = JSON.parse(edited?.content || '{}')
    expect(parsed.extendedTextMessage?.contextInfo?.stanzaId).toBe('orig_123')
    expect(parsed.extendedTextMessage?.contextInfo?.participant).toBe('alice@s.whatsapp.net')
    expect(parsed.extendedTextMessage?.contextInfo?.quotedMessage?.conversation).toBe('original question')
  })

  it('should preserve contextInfo when upserting an existing message with content without contextInfo', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } }).catch(() => {})

    const origContent = JSON.stringify({
      extendedTextMessage: {
        text: 'reply msg',
        contextInfo: {
          stanzaId: 'q_999',
          participant: 'bob@s.whatsapp.net',
          quotedMessage: { conversation: 'question?' }
        }
      }
    })

    await repository.upsertMessage({
      id: 'msg_upsert_1',
      chatJid: dummyChat,
      fromMe: true,
      senderId: null,
      participant: null,
      timestamp: 300n,
      messageType: 'extendedTextMessage',
      content: origContent,
      textContent: 'reply msg',
      isDeleted: false,
      isEdited: false,
      status: 'PENDING'
    })

    // Simulated status update / processMessage update where new content lacks contextInfo
    await repository.upsertMessage({
      id: 'msg_upsert_1',
      chatJid: dummyChat,
      fromMe: true,
      senderId: null,
      participant: null,
      timestamp: 300n,
      messageType: 'conversation',
      content: JSON.stringify({ conversation: 'reply msg' }),
      textContent: 'reply msg',
      isDeleted: false,
      isEdited: false,
      status: 'SENT'
    })

    const updated = await prisma.message.findUnique({ where: { id: 'msg_upsert_1' } })
    expect(updated?.messageType).toBe('extendedTextMessage')
    expect(updated?.status).toBe('SENT')

    const parsed = JSON.parse(updated?.content || '{}')
    expect(parsed.extendedTextMessage?.contextInfo?.stanzaId).toBe('q_999')
    expect(parsed.extendedTextMessage?.contextInfo?.participant).toBe('bob@s.whatsapp.net')
    expect(parsed.extendedTextMessage?.contextInfo?.quotedMessage?.conversation).toBe('question?')
  })

  it('should not regress delivery status on a re-delivered upsert (S2-01)', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })

    await prisma.message.create({
      data: {
        id: 'stat1', chatJid: dummyChat, fromMe: true, timestamp: 100n,
        messageType: 'conversation', content: JSON.stringify({ conversation: 'hi' }),
        textContent: 'hi', status: 'READ'
      }
    })

    // Baileys re-emits messages.upsert with no status → mapBaileysStatus → 'SENT'
    await repository.upsertMessage({
      id: 'stat1', chatJid: dummyChat, fromMe: true, senderId: null, participant: null,
      timestamp: 100n, messageType: 'conversation', content: JSON.stringify({ conversation: 'hi' }),
      textContent: 'hi', isDeleted: false, isEdited: false, status: 'SENT'
    })

    const msg = await prisma.message.findUnique({ where: { id: 'stat1' } })
    expect(msg?.status).toBe('READ')
  })

  it('should still allow forward status progression on upsert (S2-01)', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.message.create({
      data: {
        id: 'stat2', chatJid: dummyChat, fromMe: true, timestamp: 100n,
        messageType: 'conversation', content: '{}', textContent: 'x', status: 'PENDING'
      }
    })

    await repository.upsertMessage({
      id: 'stat2', chatJid: dummyChat, fromMe: true, senderId: null, participant: null,
      timestamp: 100n, messageType: 'conversation', content: '{}', textContent: 'x',
      isDeleted: false, isEdited: false, status: 'DELIVERED'
    })

    const msg = await prisma.message.findUnique({ where: { id: 'stat2' } })
    expect(msg?.status).toBe('DELIVERED')
  })

  it('should mark message as deleted', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.message.create({
      data: { id: 'msg4', chatJid: dummyChat, fromMe: false, timestamp: 10n, messageType: 'conversation', content: '{}' }
    })

    await repository.revokeMessage('msg4')
    const msg = await prisma.message.findUnique({ where: { id: 'msg4' } })
    expect(msg?.isDeleted).toBe(true)
  })

  it('should bulk sync messages efficiently', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })

    // Create an existing one to test update
    await prisma.message.create({
      data: { id: 'sync1', chatJid: dummyChat, fromMe: false, timestamp: 1n, messageType: 'conversation', content: '{"old":1}' }
    })

    const rows: MessageUpsertData[] = [
      { id: 'sync1', chatJid: dummyChat, fromMe: false, timestamp: 2n, messageType: 'conversation', content: '{"new":1}', textContent: 'updated' },
      { id: 'sync2', chatJid: dummyChat, fromMe: false, timestamp: 3n, messageType: 'conversation', content: '{}', textContent: 'new1' },
      { id: 'sync3', chatJid: dummyChat, fromMe: true, timestamp: 4n, messageType: 'conversation', content: '{}', textContent: 'new2' }
    ]

    await repository.bulkSyncMessages(rows)

    const sync1 = await prisma.message.findUnique({ where: { id: 'sync1' } })
    expect(sync1?.textContent).toBe('updated')
    expect(sync1?.timestamp).toBe(2n)

    const sync2 = await prisma.message.findUnique({ where: { id: 'sync2' } })
    expect(sync2?.textContent).toBe('new1')
  })
  describe('bulkSyncMessages batch safety (F-MSG-3)', () => {
    const quoted = { stanzaId: 'q1', participant: 'a@s.whatsapp.net', quotedMessage: { conversation: 'orig' } }
    const replyContent = JSON.stringify({
      extendedTextMessage: { text: 'reply v1', contextInfo: quoted },
      messageContextInfo: { deviceListMetadata: { senderKeyHash: 'k' } }
    })
    const editContent = JSON.stringify({ conversation: 'reply v2' })

    const base = (over: Partial<MessageUpsertData>): MessageUpsertData => ({
      id: 'r1', chatJid: dummyChat, fromMe: false, timestamp: 10n,
      messageType: 'extendedTextMessage', content: replyContent, textContent: 'reply v1',
      isEdited: false, isDeleted: false, ...over
    })
    const edit = (over: Partial<MessageUpsertData> = {}): MessageUpsertData =>
      base({ timestamp: 99n, messageType: 'conversation', content: editContent, textContent: 'reply v2', isEdited: true, ...over })
    const revoke = (): MessageUpsertData =>
      base({ timestamp: 98n, messageType: 'unknown', content: '{}', textContent: null, isDeleted: true })

    beforeEach(async () => {
      await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    })

    it.fails('original + edit in one batch keeps the quote and applies the edit', async () => {
      await repository.bulkSyncMessages([base({}), edit()])
      const row = await prisma.message.findUnique({ where: { id: 'r1' } })
      expect(row?.textContent).toBe('reply v2')
      expect(row?.isEdited).toBe(true)
      expect(row?.timestamp).toBe(10n)
      const c = JSON.parse(row!.content)
      expect(c.extendedTextMessage.text).toBe('reply v2')
      expect(c.extendedTextMessage.contextInfo.stanzaId).toBe('q1')
      expect(c.messageContextInfo).toBeDefined()
    })

    it.fails('edit row before the original in the batch still wins', async () => {
      await repository.bulkSyncMessages([edit(), base({})])
      const row = await prisma.message.findUnique({ where: { id: 'r1' } })
      expect(row?.textContent).toBe('reply v2')
      expect(row?.isEdited).toBe(true)
      expect(JSON.parse(row!.content).extendedTextMessage.contextInfo.stanzaId).toBe('q1')
    })

    it.fails('original + revoke in one batch keeps the content and marks deleted', async () => {
      await repository.bulkSyncMessages([base({}), revoke()])
      const row = await prisma.message.findUnique({ where: { id: 'r1' } })
      expect(row?.isDeleted).toBe(true)
      expect(row?.textContent).toBe('reply v1')
      expect(row?.messageType).toBe('extendedTextMessage')
    })

    it.fails('uses createMany once for a folded batch (no per-row upsert fallback)', async () => {
      const spy = vi.spyOn(prisma.message, 'upsert')
      await repository.bulkSyncMessages([base({}), edit(), base({ id: 'r2', content: '{}', textContent: 'x', messageType: 'conversation' })])
      expect(spy).not.toHaveBeenCalled()
      expect(await prisma.message.count()).toBe(2)
      spy.mockRestore()
    })

    it.fails('returns each new id once', async () => {
      const created = await repository.bulkSyncMessages([base({}), edit()])
      expect(created.map(m => m.id)).toEqual(['r1'])
    })

    it.fails('re-delivered original does not un-edit or un-delete a stored message', async () => {
      await prisma.message.create({
        data: { id: 'r1', chatJid: dummyChat, fromMe: false, timestamp: 10n, messageType: 'conversation',
          content: editContent, textContent: 'reply v2', isEdited: true, isDeleted: true }
      })
      await repository.bulkSyncMessages([base({})])
      const row = await prisma.message.findUnique({ where: { id: 'r1' } })
      expect(row?.isEdited).toBe(true)
      expect(row?.isDeleted).toBe(true)
      expect(row?.textContent).toBe('reply v2')
    })

    it('edit row for an already stored reply keeps the quote', async () => {
      await prisma.message.create({
        data: { id: 'r1', chatJid: dummyChat, fromMe: false, timestamp: 10n, messageType: 'extendedTextMessage',
          content: replyContent, textContent: 'reply v1' }
      })
      await repository.bulkSyncMessages([edit()])
      const row = await prisma.message.findUnique({ where: { id: 'r1' } })
      expect(row?.isEdited).toBe(true)
      expect(row?.textContent).toBe('reply v2')
      expect(JSON.parse(row!.content).extendedTextMessage.contextInfo.stanzaId).toBe('q1')
    })

    it.fails('bulkCreateMessages collapses duplicate ids instead of falling back', async () => {
      const spy = vi.spyOn(prisma.message, 'upsert')
      await repository.bulkCreateMessages([base({}), base({ textContent: 'dup' })])
      expect(spy).not.toHaveBeenCalled()
      expect(await prisma.message.count()).toBe(1)
      spy.mockRestore()
    })
  })
})
