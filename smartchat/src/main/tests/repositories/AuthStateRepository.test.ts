import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { AuthStateRepository } from '../../services/auth/AuthStateRepository'
import { getPrismaClient } from '../helpers'

describe('AuthStateRepository', () => {
  let prisma: PrismaClient
  let repository: AuthStateRepository

  beforeAll(() => {
    prisma = getPrismaClient()
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
