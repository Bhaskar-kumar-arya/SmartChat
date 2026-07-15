import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIChatSessionService } from '../../../services/ai/AIChatSessionService'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData')
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
  }
}))

describe('AIChatSessionService', () => {
  let mockPrisma: any
  let service: AIChatSessionService

  beforeEach(() => {
    mockPrisma = {
      aIChatSession: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      aIChatMessage: {
        deleteMany: vi.fn(),
        createMany: vi.fn()
      },
      $transaction: vi.fn((cb) => cb(mockPrisma))
    }

    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(false)
    service = new AIChatSessionService(mockPrisma as unknown as PrismaClient)
  })

  it('should create a session', async () => {
    mockPrisma.aIChatSession.create.mockResolvedValue({ id: '1', title: 'Test', createdAt: 123n, updatedAt: 123n })
    const session = await service.createSession('Test', 'model')
    expect(session.id).toBe('1')
    expect(mockPrisma.aIChatSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: 'Test', modelId: 'model' })
    }))
  })

  it('should get a session with messages parsed', async () => {
    mockPrisma.aIChatSession.findUnique.mockResolvedValue({
      id: '1',
      title: 'Test',
      createdAt: 123n,
      updatedAt: 123n,
      messages: [
        { id: 'm1', content: 'hello', contexts: '[{"jid":"test"}]', mentions: '[]' }
      ]
    })

    const session = await service.getSession('1')
    expect(session).toBeDefined()
    expect(session!.messages[0].contexts).toEqual([{ jid: 'test' }])
  })

  it('should save messages within a transaction', async () => {
    await service.saveMessages('session-1', [
      { role: 'user', content: 'msg1' },
      { role: 'ai', content: 'msg2' }
    ])

    expect(mockPrisma.$transaction).toHaveBeenCalled()
    expect(mockPrisma.aIChatMessage.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 'session-1' } })
    expect(mockPrisma.aIChatMessage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'msg1', orderIndex: 0 }),
        expect.objectContaining({ role: 'ai', content: 'msg2', orderIndex: 1 })
      ])
    })
    expect(mockPrisma.aIChatSession.update).toHaveBeenCalled()
  })

  it('should read and write preferences', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ autoSaveChats: false, model: 'test-model' }))

    const options = await service.getAIOptions()
    expect(options.autoSaveChats).toBe(false)
    expect(options.model).toBe('test-model')

    await service.setAIOptions({ useThinkMode: false })
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"useThinkMode": false')
    )
  })
})
