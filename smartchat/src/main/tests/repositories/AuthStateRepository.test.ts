import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { join } from 'path'
import { AuthStateRepository } from '../../services/auth/AuthStateRepository'

describe('AuthStateRepository', () => {
  let prisma: PrismaClient
  let repository: AuthStateRepository

  beforeAll(() => {
    const dbPath = join(__dirname, '../../../../prisma/test.db')
    const adapter = new (PrismaBetterSqlite3 as any)({ url: `file:${dbPath}` })
    prisma = new PrismaClient({ adapter })
    repository = new AuthStateRepository(prisma)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.authState.deleteMany()
  })

  it('should set and get auth state', async () => {
    await repository.setValue('creds', 'my-credentials-data')
    
    const val = await repository.getValue('creds')
    expect(val).toBe('my-credentials-data')
    
    // update
    await repository.setValue('creds', 'new-data')
    const updated = await repository.getValue('creds')
    expect(updated).toBe('new-data')
  })

  it('should return null for missing key', async () => {
    const val = await repository.getValue('missing')
    expect(val).toBeNull()
  })

  it('should delete auth state', async () => {
    await repository.setValue('del-key', 'data')
    await repository.deleteValue('del-key')
    
    const val = await repository.getValue('del-key')
    expect(val).toBeNull()
  })
})
