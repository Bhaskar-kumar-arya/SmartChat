import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { MessageQueryRepository } from '../../services/messages/MessageQueryRepository'
import { MessageQueryFilter } from '../../domain/filters'

describe('MessageQueryRepository', () => {
  let prisma: PrismaClient
  let repository: MessageQueryRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new MessageQueryRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.reaction.deleteMany()
    await prisma.messageVector.deleteMany()
    await prisma.message.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.identity.deleteMany()
  })

  const dummyChat = '123@g.us'

  it('should find last message in a chat using raw SQL', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.identity.create({ data: { id: 10, phoneNumber: 'sender@s.whatsapp.net', displayName: 'Sender' } })
    
    // msg1
    await prisma.message.create({
      data: { id: 'msg1', chatJid: dummyChat, senderId: 10, fromMe: false, timestamp: 10n, messageType: 'conversation', content: '{}', textContent: 'first' }
    })
    // msg2 (newer)
    await prisma.message.create({
      data: { id: 'msg2', chatJid: dummyChat, senderId: 10, fromMe: false, timestamp: 20n, messageType: 'conversation', content: '{}', textContent: 'second' }
    })

    const last = await repository.findLastMessage(dummyChat)
    expect(last?.id).toBe('msg2')
    expect(last?.textContent).toBe('second')
    expect(last?.sender?.displayName).toBe('Sender')
  })

  it('should apply filters correctly in findMessageIdsOnly', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.chat.create({ data: { jid: 'other@g.us', type: 'GROUP' } })

    await prisma.message.create({ data: { id: 'm1', chatJid: dummyChat, fromMe: true, timestamp: 10n, messageType: 'conversation', content: '{}', textContent: 'hello world' } })
    await prisma.message.create({ data: { id: 'm2', chatJid: dummyChat, fromMe: false, timestamp: 20n, messageType: 'conversation', content: '{}', textContent: 'bye world' } })
    await prisma.message.create({ data: { id: 'm3', chatJid: 'other@g.us', fromMe: false, timestamp: 30n, messageType: 'conversation', content: '{}', textContent: 'hello there' } })

    const filter1: MessageQueryFilter = { chatJid: dummyChat, fromMe: true }
    const res1 = await repository.findMessageIdsOnly(filter1)
    expect(res1).toEqual(['m1'])

    const filter2: MessageQueryFilter = { textContentContains: 'hello' }
    const res2 = await repository.findMessageIdsOnly(filter2)
    expect(res2.sort()).toEqual(['m1', 'm3'].sort())

    const filter3: MessageQueryFilter = { fromDate: 15n, toDate: 25n }
    const res3 = await repository.findMessageIdsOnly(filter3)
    expect(res3).toEqual(['m2'])
  })

  it('should execute raw SQL query and return rows', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.message.create({ data: { id: 'm1', chatJid: dummyChat, fromMe: true, timestamp: 10n, messageType: 'conversation', content: '{}' } })
    
    const rows = await repository.queryMessageIdsBySql('SELECT id FROM Message WHERE chatJid = ? LIMIT 1', [dummyChat])
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe('m1')
  })

  it('should find messages from timestamp with lookBehind', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    
    // Create 5 messages chronologically
    await prisma.message.create({ data: { id: 'm1', chatJid: dummyChat, fromMe: true, timestamp: 1n, messageType: 'conversation', content: '{}' } })
    await prisma.message.create({ data: { id: 'm2', chatJid: dummyChat, fromMe: true, timestamp: 2n, messageType: 'conversation', content: '{}' } })
    await prisma.message.create({ data: { id: 'm3', chatJid: dummyChat, fromMe: true, timestamp: 3n, messageType: 'conversation', content: '{}' } })
    await prisma.message.create({ data: { id: 'm4', chatJid: dummyChat, fromMe: true, timestamp: 4n, messageType: 'conversation', content: '{}' } })
    await prisma.message.create({ data: { id: 'm5', chatJid: dummyChat, fromMe: true, timestamp: 5n, messageType: 'conversation', content: '{}' } })

    // Find from timestamp 3, look behind 1
    // Target = >= 3, which is m3, m4, m5
    // LookBehind = 1 before 3, which is m2
    // Result should be [m2, m3, m4, m5]
    
    const messages = await repository.findMessagesFromTimestamp(dummyChat, 3n, 1)
    expect(messages.length).toBe(4)
    expect(messages.map(m => m.id)).toEqual(['m2', 'm3', 'm4', 'm5'])
  })

  it('should paginate chat messages with sender correctly', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.identity.create({ data: { id: 20, phoneNumber: 's2@s.whatsapp.net', displayName: 'S2' } })

    await prisma.message.create({ data: { id: 'm1', chatJid: dummyChat, senderId: 20, fromMe: false, timestamp: 100n, messageType: 'conversation', content: '{}' } })
    await prisma.message.create({ data: { id: 'm2', chatJid: dummyChat, senderId: 20, fromMe: false, timestamp: 200n, messageType: 'conversation', content: '{}' } })
    await prisma.message.create({ data: { id: 'm3', chatJid: dummyChat, senderId: 20, fromMe: false, timestamp: 300n, messageType: 'conversation', content: '{}' } })

    // limit 2, skip 1 -> should return [m2, m1] because it orders by timestamp DESC
    const page = await repository.findChatMessagesWithSender(dummyChat, 1, 2)
    
    expect(page.length).toBe(2)
    expect(page[0].id).toBe('m2')
    expect(page[1].id).toBe('m1')
    expect(page[0].sender?.displayName).toBe('S2')
  })
})
