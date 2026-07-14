import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { ReceiptRepository } from '../../services/messages/ReceiptRepository'

describe('ReceiptRepository', () => {
  let prisma: PrismaClient
  let repository: ReceiptRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new ReceiptRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.messageReceipt.deleteMany()
    await prisma.chatMember.deleteMany()
    await prisma.message.deleteMany()
    await prisma.identity.deleteMany()
    await prisma.chat.deleteMany()
  })

  const dummyChat = '123@g.us'

  it('should upsert a message receipt', async () => {
    await repository.upsertMessageReceipt({
      messageId: 'msg1',
      userJid: 'user1@s.whatsapp.net',
      status: 'DELIVERY',
      timestamp: 100n
    })

    let receipt = await prisma.messageReceipt.findUnique({
      where: { messageId_userJid: { messageId: 'msg1', userJid: 'user1@s.whatsapp.net' } }
    })
    expect(receipt?.status).toBe('DELIVERY')

    // update
    await repository.upsertMessageReceipt({
      messageId: 'msg1',
      userJid: 'user1@s.whatsapp.net',
      status: 'READ',
      timestamp: 200n
    })

    receipt = await prisma.messageReceipt.findUnique({
      where: { messageId_userJid: { messageId: 'msg1', userJid: 'user1@s.whatsapp.net' } }
    })
    expect(receipt?.status).toBe('READ')
    expect(receipt?.timestamp).toBe(200n)
  })

  it('should get message receipts and counts', async () => {
    await repository.upsertMessageReceipt({ messageId: 'msg2', userJid: 'u1@s.whatsapp.net', status: 'READ', timestamp: 10n })
    await repository.upsertMessageReceipt({ messageId: 'msg2', userJid: 'u2@s.whatsapp.net', status: 'DELIVERY', timestamp: 20n })
    await repository.upsertMessageReceipt({ messageId: 'msg2', userJid: 'u3@s.whatsapp.net', status: 'READ', timestamp: 30n })

    const readCount = await repository.getMessageReceiptsCount('msg2', 'READ')
    expect(readCount).toBe(2)

    const multipleCount = await repository.getMessageReceiptsWithStatusesCount('msg2', ['READ', 'DELIVERY'])
    expect(multipleCount).toBe(3)

    const all = await repository.getMessageReceipts('msg2')
    expect(all.length).toBe(3)
    expect(all[0].userJid).toBe('u3@s.whatsapp.net') // desc timestamp sorting
  })

  it('should find message and update status', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.message.create({ data: { id: 'msg3', chatJid: dummyChat, fromMe: true, timestamp: 10n, messageType: 'conversation', content: '{}' } })

    const msg = await repository.findMessageById('msg3')
    expect(msg?.id).toBe('msg3')

    await repository.updateMessageStatus('msg3', 'PLAYED')
    const updated = await prisma.message.findUnique({ where: { id: 'msg3' } })
    expect(updated?.status).toBe('PLAYED')
  })

  it('should get chat members count', async () => {
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.identity.create({ data: { id: 100, phoneNumber: 'a@s.whatsapp.net' } })
    await prisma.identity.create({ data: { id: 101, phoneNumber: 'b@s.whatsapp.net' } })
    await prisma.chatMember.create({ data: { chatJid: dummyChat, identityId: 100 } })
    await prisma.chatMember.create({ data: { chatJid: dummyChat, identityId: 101 } })

    const count = await repository.getChatMembersCount(dummyChat)
    expect(count).toBe(2)
  })
})
