import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { CommunityRepository } from '../../services/chats/CommunityRepository'

describe('CommunityRepository', () => {
  let prisma: PrismaClient
  let repository: CommunityRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new CommunityRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.chat.deleteMany()
    await prisma.community.deleteMany()
  })

  it('should upsert a community', async () => {
    // create
    const comm = await repository.upsertCommunity('comm1@g.us', 'Community 1')
    expect(comm.id).toBeDefined()
    expect(comm.jid).toBe('comm1@g.us')
    expect(comm.name).toBe('Community 1')
    expect(comm.announceJid).toBeNull()

    // update
    const updated = await repository.upsertCommunity('comm1@g.us', 'Community 1 Updated')
    expect(updated.id).toBe(comm.id)
    expect(updated.name).toBe('Community 1 Updated')
  })

  it('should update community announce JID', async () => {
    const comm = await repository.upsertCommunity('comm2@g.us', 'Community 2')
    
    const updated = await repository.updateCommunityAnnounceJid(comm.id, 'announce2@g.us')
    expect(updated.id).toBe(comm.id)
    expect(updated.announceJid).toBe('announce2@g.us')

    const dbComm = await prisma.community.findUnique({ where: { id: comm.id } })
    expect(dbComm?.announceJid).toBe('announce2@g.us')
  })
})
