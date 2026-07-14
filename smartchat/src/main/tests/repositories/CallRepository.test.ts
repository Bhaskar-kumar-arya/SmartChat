import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { CallRepository } from '../../services/calls/CallRepository'

describe('CallRepository', () => {
  let prisma: PrismaClient
  let repository: CallRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new CallRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.callLog.deleteMany()
  })

  it('should upsert and get call log', async () => {
    await repository.upsertCallLog({
      id: 'call1',
      callerJid: 'user@s.whatsapp.net',
      isVideo: true,
      isGroup: false,
      status: 'missed',
      timestamp: 100n
    })

    const call = await repository.getCallLog('call1')
    expect(call).not.toBeNull()
    expect(call?.callerJid).toBe('user@s.whatsapp.net')
    expect(call?.isVideo).toBe(true)
    expect(call?.status).toBe('missed')

    // update
    await repository.upsertCallLog({
      id: 'call1',
      callerJid: 'user@s.whatsapp.net',
      isVideo: true,
      isGroup: false,
      status: 'accepted',
      timestamp: 200n
    })

    const updated = await repository.getCallLog('call1')
    expect(updated?.status).toBe('accepted')
    expect(updated?.timestamp).toBe(200n)
  })

  it('should return null for missing call', async () => {
    const call = await repository.getCallLog('missing')
    expect(call).toBeNull()
  })
})
