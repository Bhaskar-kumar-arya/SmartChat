import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { CallRepository } from '../../services/calls/CallRepository'
import { getPrismaClient } from '../helpers'

describe('CallRepository', () => {
  let prisma: PrismaClient
  let repository: CallRepository

  beforeAll(() => {
    prisma = getPrismaClient()
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
