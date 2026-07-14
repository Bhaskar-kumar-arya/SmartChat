import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { MessageRepository } from '../../services/messages/MessageRepository'
import { MessageUpsertData } from '../../services/messages/IMessageRepository'

describe('MessageRepository', () => {
  let prisma: PrismaClient
  let repository: MessageRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
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
})
