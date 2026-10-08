import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { ReactionRepository } from '../../services/messages/ReactionRepository'
import { getPrismaClient, resetDb } from '../helpers'
import { makeChat, makeIdentity, makeMessage } from '../factories'

describe('ReactionRepository', () => {
  let prisma: PrismaClient
  let repository: ReactionRepository

  beforeAll(() => {
    prisma = getPrismaClient()
    repository = new ReactionRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDb(prisma)
  })

  const dummyChat = '123@g.us'

  it('should upsert and delete reaction', async () => {
    await makeIdentity(prisma, { id: 1, phoneNumber: 'u1@s.whatsapp.net' })
    await makeChat(prisma, { jid: dummyChat, type: 'GROUP' })
    await makeMessage(prisma, dummyChat, { id: 'm1', timestamp: 10n })

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

    await repository.bulkSyncReactions(pending)

    const reactions = await prisma.reaction.findMany()
    expect(reactions.length).toBe(1)
    expect(reactions[0].messageId).toBe('m2')
    expect(reactions[0].senderId).toBe(2)
    expect(reactions[0].text).toBe('🥶')
  })

  describe('deferred reactions (B-MSG-01)', () => {
    async function seedReactor(): Promise<void> {
      await prisma.identity.create({ data: { id: 2, phoneNumber: 'u2@s.whatsapp.net' } })
      await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    }
    async function seedMessage(id: string): Promise<void> {
      await prisma.message.create({ data: { id, chatJid: dummyChat, fromMe: false, timestamp: 10n, messageType: 'conversation', content: '{}' } })
    }

    it('applies a reaction on a later call once its target message exists', async () => {
      await seedReactor()
      await repository.bulkSyncReactions([{ targetId: 'late', reactorId: 2, emoji: '🔥', timestamp: 20n }])
      expect(await prisma.reaction.count()).toBe(0)

      await seedMessage('late')
      await repository.bulkSyncReactions([])
      const rows = await prisma.reaction.findMany()
      expect(rows.map(r => r.text)).toEqual(['🔥'])
    })

    it('keeps the newest deferred reaction per target and reactor', async () => {
      await seedReactor()
      await repository.bulkSyncReactions([{ targetId: 'late', reactorId: 2, emoji: '🔥', timestamp: 20n }])
      await repository.bulkSyncReactions([{ targetId: 'late', reactorId: 2, emoji: '🥶', timestamp: 30n }])
      await seedMessage('late')
      await repository.flushDeferredReactions()
      expect((await prisma.reaction.findMany()).map(r => r.text)).toEqual(['🥶'])
    })

    it('flushDeferredReactions applies what it can, then forgets the rest', async () => {
      await seedReactor()
      await repository.bulkSyncReactions([{ targetId: 'ghost', reactorId: 2, emoji: '🔥', timestamp: 20n }])
      await repository.flushDeferredReactions()
      await seedMessage('ghost')
      await repository.bulkSyncReactions([])
      expect(await prisma.reaction.count()).toBe(0)
    })

    it('discardDeferredReactions drops them unapplied', async () => {
      await seedReactor()
      await repository.bulkSyncReactions([{ targetId: 'late', reactorId: 2, emoji: '🔥', timestamp: 20n }])
      repository.discardDeferredReactions()
      await seedMessage('late')
      await repository.bulkSyncReactions([])
      expect(await prisma.reaction.count()).toBe(0)
    })
  })

  it('should not let a stale reaction event clobber a newer stored one (S2-05)', async () => {
    await prisma.identity.create({ data: { id: 1, phoneNumber: 'u1@s.whatsapp.net' } })
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.message.create({ data: { id: 'm1', chatJid: dummyChat, fromMe: false, timestamp: 10n, messageType: 'conversation', content: '{}' } })

    // Live reaction at t=200
    await repository.upsertReaction('m1', 1, '❤️', 200n)

    // Out-of-order history-sync delivery of an older reaction (t=100) — must be ignored
    await repository.upsertReaction('m1', 1, '👍', 100n)
    let reactions = await prisma.reaction.findMany({ where: { messageId: 'm1' } })
    expect(reactions[0].text).toBe('❤️')
    expect(reactions[0].timestamp).toBe(200n)

    // Out-of-order older *removal* (t=150) — must not resurrect-delete the newer reaction
    await repository.upsertReaction('m1', 1, '', 150n)
    reactions = await prisma.reaction.findMany({ where: { messageId: 'm1' } })
    expect(reactions.length).toBe(1)
    expect(reactions[0].text).toBe('❤️')
  })

  it('bulkSyncReactions should not roll back a newer stored reaction (S2-05)', async () => {
    await prisma.identity.create({ data: { id: 2, phoneNumber: 'u2@s.whatsapp.net' } })
    await prisma.chat.create({ data: { jid: dummyChat, type: 'GROUP' } })
    await prisma.message.create({ data: { id: 'm2', chatJid: dummyChat, fromMe: false, timestamp: 10n, messageType: 'conversation', content: '{}' } })

    await repository.upsertReaction('m2', 2, '🔥', 500n)

    await repository.bulkSyncReactions([{ targetId: 'm2', reactorId: 2, emoji: '😀', timestamp: 100n }])

    const reactions = await prisma.reaction.findMany({ where: { messageId: 'm2' } })
    expect(reactions).toHaveLength(1)
    expect(reactions[0].text).toBe('🔥')
    expect(reactions[0].timestamp).toBe(500n)
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

  // R-SOLID-M-13: failed writes must reject.
  it('upsertReaction rejects when the upsert fails', async () => {
    const spy = vi.spyOn(prisma.reaction, 'upsert').mockRejectedValueOnce(new Error('db locked'))
    try {
      await expect(repository.upsertReaction('m1', 1, 'x', 100n)).rejects.toThrow('db locked')
    } finally {
      spy.mockRestore()
    }
  })

  it('upsertReaction (removal) rejects when the delete fails', async () => {
    const spy = vi.spyOn(prisma.reaction, 'deleteMany').mockRejectedValueOnce(new Error('db locked'))
    try {
      await expect(repository.upsertReaction('m1', 1, null, 100n)).rejects.toThrow('db locked')
    } finally {
      spy.mockRestore()
    }
  })

  it('deleteReactions rejects when the delete fails', async () => {
    const spy = vi.spyOn(prisma.reaction, 'deleteMany').mockRejectedValueOnce(new Error('db locked'))
    try {
      await expect(repository.deleteReactions('m1', 1)).rejects.toThrow('db locked')
    } finally {
      spy.mockRestore()
    }
  })
})
