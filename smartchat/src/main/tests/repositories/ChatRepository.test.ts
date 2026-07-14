import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { ChatRepository } from '../../services/chats/ChatRepository'

describe('ChatRepository', () => {
  let prisma: PrismaClient
  let repository: ChatRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new ChatRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.reaction.deleteMany()
    await prisma.message.deleteMany()
    await prisma.chatMember.deleteMany()
    await prisma.identityAlias.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.community.deleteMany()
    await prisma.identity.deleteMany()
  })

  it('should upsert and find a chat', async () => {
    await repository.upsertChat('123@g.us', {
      name: 'Test Group',
      type: 'GROUP',
      unreadCount: 5,
      timestamp: 100n,
      pinned: 1
    })

    const found = await repository.findChatByJid('123@g.us')
    expect(found).not.toBeNull()
    expect(found?.name).toBe('Test Group')
    expect(found?.unreadCount).toBe(5)
    expect(found?.timestamp).toBe(100n)
    expect(found?.pinned).toBe(1)

    // update
    await repository.upsertChat('123@g.us', {
      unreadCount: 0,
      timestamp: 200n
    })

    const updated = await repository.findChatByJid('123@g.us')
    expect(updated?.unreadCount).toBe(0)
    expect(updated?.timestamp).toBe(200n)
    expect(updated?.name).toBe('Test Group') // Name should be preserved
  })

  it('should increment unread count and update timestamp', async () => {
    await repository.upsertChat('111@s.whatsapp.net', { type: 'DM', unreadCount: 2, timestamp: 10n })
    
    await repository.incrementUnread('111@s.whatsapp.net', 50n, 3)
    
    const chat = await repository.findChatByJid('111@s.whatsapp.net')
    expect(chat?.unreadCount).toBe(5)
    expect(chat?.timestamp).toBe(50n)
  })

  it('should support pagination, sorting by pinned and timestamp', async () => {
    await repository.upsertChat('chat1', { type: 'DM', timestamp: 10n, pinned: 0 })
    await repository.upsertChat('chat2', { type: 'DM', timestamp: 30n, pinned: 0 })
    await repository.upsertChat('chat3', { type: 'DM', timestamp: 20n, pinned: 1 }) // pinned goes first
    await repository.upsertChat('chat4', { type: 'DM', timestamp: 5n, pinned: 0 })

    const page1 = await repository.findChatsPaginated(0, 2)
    expect(page1.length).toBe(2)
    // chat3 should be first because it is pinned
    expect(page1[0].jid).toBe('chat3')
    // then chat2 because timestamp 30 is highest among unpinned
    expect(page1[1].jid).toBe('chat2')

    const page2 = await repository.findChatsPaginated(2, 2)
    expect(page2.length).toBe(2)
    expect(page2[0].jid).toBe('chat1') // timestamp 10
    expect(page2[1].jid).toBe('chat4') // timestamp 5
  })

  it('should find chats by community jids', async () => {
    // create a community
    const comm = await prisma.community.create({ data: { jid: 'comm1@g.us', name: 'Community 1' } })
    
    // chat belonging to community
    await repository.upsertChat('sub1@g.us', { type: 'GROUP', communityId: comm.id })
    // another chat belonging to community
    await repository.upsertChat('sub2@g.us', { type: 'GROUP', communityId: comm.id })
    // unrelated chat
    await repository.upsertChat('unrelated@g.us', { type: 'GROUP' })
    // the community root chat itself
    await repository.upsertChat('comm1@g.us', { type: 'COMMUNITY', communityId: comm.id })

    const chats = await repository.findChatsByCommunityJids(['comm1@g.us'])
    // Should return sub1, sub2, and comm1
    expect(chats.length).toBe(3)
    
    const jids = chats.map(c => c.jid).sort()
    expect(jids).toEqual(['comm1@g.us', 'sub1@g.us', 'sub2@g.us'])
    
    // Check if community relation is populated
    const sub1 = chats.find(c => c.jid === 'sub1@g.us')
    expect(sub1?.community?.name).toBe('Community 1')
  })

  it('should search chats by name or jid', async () => {
    await repository.upsertChat('alpha@g.us', { type: 'GROUP', name: 'Alpha Team' })
    await repository.upsertChat('beta@g.us', { type: 'GROUP', name: 'Beta Squad' })
    await repository.upsertChat('charlie@g.us', { type: 'DM', name: 'Charlie' })

    const resultsName = await repository.searchChats('Alpha')
    expect(resultsName.length).toBe(1)
    expect(resultsName[0].jid).toBe('alpha@g.us')

    const resultsJid = await repository.searchChats('charlie@g.us')
    expect(resultsJid.length).toBe(1)
    expect(resultsJid[0].name).toBe('Charlie')
  })

  it('should bulk create chats', async () => {
    await repository.bulkCreateChats([
      { jid: 'bulk1@s.whatsapp.net', type: 'DM' },
      { jid: 'bulk2@g.us', type: 'GROUP' }
    ])

    const count = await repository.countChats()
    expect(count).toBe(2)

    const c1 = await repository.findChatByJid('bulk1@s.whatsapp.net')
    expect(c1?.type).toBe('DM')
    
    const c2 = await repository.findChatByJid('bulk2@g.us')
    expect(c2?.type).toBe('GROUP')
  })
})
