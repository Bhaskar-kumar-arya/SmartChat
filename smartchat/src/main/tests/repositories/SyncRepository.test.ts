import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { SyncRepository } from '../../services/sync/SyncRepository'

describe('SyncRepository', () => {
  let prisma: PrismaClient
  let repository: SyncRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new SyncRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.lidMap.deleteMany()
    await prisma.chatMember.deleteMany()
    await prisma.identityAlias.deleteMany()
    await prisma.identity.deleteMany()
    await prisma.chat.deleteMany()
    await prisma.community.deleteMany()
  })

  it('should bulk upsert communities', async () => {
    await repository.bulkUpsertCommunities([{ jid: 'c1@g.us', name: 'Comm 1' }])
    
    // upsert existing and new
    const comms = await repository.bulkUpsertCommunities([
      { jid: 'c1@g.us', name: 'Comm 1' },
      { jid: 'c2@g.us', name: 'Comm 2' }
    ])
    
    expect(comms.length).toBe(2)
    const dbComms = await prisma.community.findMany()
    expect(dbComms.length).toBe(2)
  })

  it('should bulk update community announces', async () => {
    const c1 = await prisma.community.create({ data: { jid: 'c1@g.us', name: 'Comm 1' } })
    
    await repository.bulkUpdateCommunityAnnounces([
      { id: c1.id, announceJid: 'ann@g.us' }
    ])

    const updated = await prisma.community.findUnique({ where: { id: c1.id } })
    expect(updated?.announceJid).toBe('ann@g.us')
  })

  it('should bulk create and update chats', async () => {
    await repository.bulkCreateChats([
      { jid: 'ch1@g.us', type: 'GROUP', unreadCount: 1, timestamp: 1n, pinned: 0, muteExpiration: 0n, isArchived: false, name: null, profilePictureUrl: null, communityId: null }
    ])

    const chats = await repository.findExistingChats(['ch1@g.us', 'ch2@g.us'])
    expect(chats.length).toBe(1)
    expect(chats[0].jid).toBe('ch1@g.us')

    await repository.bulkUpdateChats([
      { jid: 'ch1@g.us', unreadCount: 5 }
    ])
    
    const updated = await prisma.chat.findUnique({ where: { jid: 'ch1@g.us' } })
    expect(updated?.unreadCount).toBe(5)
  })

  it('should bulk create identities and aliases', async () => {
    await repository.bulkCreateIdentities(['111', '222'])
    const idents = await repository.findIdentitiesByPhoneNumbers(['111', '222', '333'])
    expect(idents.length).toBe(2)

    await repository.bulkCreateIdentityAliases([
      { jid: '111-lid@lid', type: 'LID', identityId: idents[0].id }
    ])

    const aliases = await repository.findIdentityAliases(['111-lid@lid'])
    expect(aliases.length).toBe(1)
    expect(aliases[0].identityId).toBe(idents[0].id)
  })

  it('should bulk upsert LidMaps', async () => {
    await repository.bulkUpsertLidMaps([
      { lid: '1@lid', pn: '1@pn', source: 'sync' }
    ], new Set())

    // update existing and insert new
    await repository.bulkUpsertLidMaps([
      { lid: '1@lid', pn: '1-updated@pn', source: 'sync' },
      { lid: '2@lid', pn: '2@pn', source: 'sync' }
    ], new Set(['1@lid']))

    const maps = await repository.findLidMaps(['1@lid', '2@lid'])
    expect(maps.length).toBe(2)
    const m1 = maps.find(m => m.lid === '1@lid')
    expect(m1?.pn).toBe('1-updated@pn')
  })

  it('should bulk upsert chat members', async () => {
    await prisma.chat.create({ data: { jid: 'group1@g.us', type: 'GROUP' } })
    await prisma.identity.create({ data: { id: 10, phoneNumber: 'u1' } })

    const existingMap = new Map<string, string>()

    await repository.bulkUpsertChatMembers([
      { chatJid: 'group1@g.us', identityId: 10, role: 'MEMBER' }
    ], existingMap)

    let members = await repository.findExistingMemberRoles(['group1@g.us'])
    expect(members.length).toBe(1)
    expect(members[0].role).toBe('MEMBER')

    existingMap.set('group1@g.us_10', 'MEMBER')
    
    await repository.bulkUpsertChatMembers([
      { chatJid: 'group1@g.us', identityId: 10, role: 'ADMIN' }
    ], existingMap)

    members = await repository.findExistingMemberRoles(['group1@g.us'])
    expect(members[0].role).toBe('ADMIN')
  })
})
