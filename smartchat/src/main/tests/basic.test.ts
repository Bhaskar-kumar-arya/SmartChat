import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getPrismaClient } from './helpers'

describe('Database Connectivity and Schema Validation', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = getPrismaClient()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('should be able to connect and run queries', async () => {
    const count = await prisma.identity.count()
    expect(count).toBe(0)
  })

  it('should insert and retrieve an Identity record successfully', async () => {
    const created = await prisma.identity.create({
      data: {
        phoneNumber: '1234567890@s.whatsapp.net',
        displayName: 'Test User',
        isMe: false,
      },
    })

    expect(created.id).toBeDefined()
    expect(created.phoneNumber).toBe('1234567890@s.whatsapp.net')
    expect(created.displayName).toBe('Test User')

    const fetched = await prisma.identity.findUnique({
      where: { id: created.id },
    })

    expect(fetched).not.toBeNull()
    expect(fetched?.phoneNumber).toBe('1234567890@s.whatsapp.net')
  })
})
