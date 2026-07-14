import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { ReactionRepository } from '../../services/messages/ReactionRepository'

describe('ReactionRepository', () => {
  let prisma: PrismaClient
  let repository: ReactionRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new ReactionRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.reaction.deleteMany()
    await prisma.message.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.identity.deleteMany()
  })

  const dummyChat = '123@g.us'

  it('should upsert and delete reaction', async () => {
    await prisma.identity.create({ data: { id: 1, phoneNumber: 'u1@s.whatsapp.net' } })
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.message.create({ data: { id: 'm1', chatJid: dummyChat, fromMe: false, timestamp: 10n, messageType: 'conversation', content: '{}' } })

    // Create reaction
    await repository.upsertReaction('m1', 1, '👍', 100n)
    
    let reactions = await prisma.reaction.findMany({ where: { messageId: 'm1' } })
    expect(reactions.length).toBe(1)
    expect(reactions[0].text).toBe('👍')

    // Update reaction
    await repository.upsertReaction('m1', 1, '❤️', 200n)
    reactions = await prisma.reaction.findMany({ where: { messageId: 'm1' } })
    expect(reactions.length).toBe(1)
    expect(reactions[0].text).toBe('❤️')
    expect(reactions[0].timestamp).toBe(200n)

    // Remove reaction (empty string)
    await repository.upsertReaction('m1', 1, '', 300n)
    reactions = await prisma.reaction.findMany({ where: { messageId: 'm1' } })
    expect(reactions.length).toBe(0)
  })

  it('should bulk sync reactions, validating existence', async () => {
    await prisma.identity.create({ data: { id: 2, phoneNumber: 'u2@s.whatsapp.net' } })
    await prisma.identity.create({ data: { id: 3, phoneNumber: 'u3@s.whatsapp.net' } })
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.message.create({ data: { id: 'm2', chatJid: dummyChat, fromMe: false, timestamp: 10n, messageType: 'conversation', content: '{}' } })
    // m3 is intentionally not created to test existence check

    const pending = [
      { targetId: 'm2', reactorId: 2, emoji: '🔥', timestamp: 10n },
      { targetId: 'm2', reactorId: 2, emoji: '🥶', timestamp: 20n }, // newer should win
      { targetId: 'm3', reactorId: 3, emoji: '🎉', timestamp: 30n }, // should be ignored (m3 missing)
      { targetId: 'm2', reactorId: 999, emoji: '🎉', timestamp: 30n } // should be ignored (user missing)
    ]

    await repository.bulkSyncReactions(pending, new Set())

    const reactions = await prisma.reaction.findMany()
    expect(reactions.length).toBe(1)
    expect(reactions[0].messageId).toBe('m2')
    expect(reactions[0].senderId).toBe(2)
    expect(reactions[0].text).toBe('🥶')
  })

  it('should find last reaction for chat', async () => {
    await prisma.identity.create({ data: { id: 4, phoneNumber: 'u4@s.whatsapp.net', displayName: 'User 4' } })
    await prisma.chat.create({ data: { jid: 'chat2@g.us', type: 'GROUP' } })
    await prisma.message.create({ data: { id: 'm4', chatJid: 'chat2@g.us', fromMe: false, timestamp: 10n, messageType: 'conversation', content: '{}', textContent: 'hello' } })
    
    await repository.upsertReaction('m4', 4, '✅', 100n)
    
    const last = await repository.findLastReaction('chat2@g.us')
    expect(last?.text).toBe('✅')
    expect(last?.sender.displayName).toBe('User 4')
    expect(last?.message.id).toBe('m4')
  })
})
