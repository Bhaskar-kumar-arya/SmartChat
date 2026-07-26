import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { LidMapRepository } from '../../services/contacts/LidMapRepository'
import { getPrismaClient } from '../helpers'

describe('LidMapRepository', () => {
  let prisma: PrismaClient
  let repository: LidMapRepository

  beforeAll(() => {
    prisma = getPrismaClient()
    repository = new LidMapRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.lidMap.deleteMany()
  })

  it('should upsert and find LidMap', async () => {
    await repository.upsertLidMap('123@lid', '123@s.whatsapp.net', 'test')

    const found = await repository.findLidMap('123@s.whatsapp.net')
    expect(found).not.toBeNull()
    expect(found?.lid).toBe('123@lid')
    expect(found?.source).toBe('test')

    // update
    await repository.upsertLidMap('123@lid', '321@s.whatsapp.net', 'update')
    
    const maps = await repository.findLidMaps(['123@lid'])
    expect(maps.length).toBe(1)
    expect(maps[0].pn).toBe('321@s.whatsapp.net')
    expect(maps[0].source).toBe('update')
  })
})
