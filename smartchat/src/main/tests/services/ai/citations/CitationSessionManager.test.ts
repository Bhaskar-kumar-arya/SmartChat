import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CitationSessionManager } from '../../../../services/ai/citations/CitationSessionManager'
import { PrismaClient } from '@prisma/client'
import { CitationEntity } from '../../../../services/ai/citations/ICitationEmitter'

describe('CitationSessionManager', () => {
  let mockPrisma: any
  let manager: CitationSessionManager

  beforeEach(() => {
    mockPrisma = {
      citation: {
        aggregate: vi.fn(),
        createMany: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn()
      },
      $transaction: vi.fn(async (cb) => await cb(mockPrisma))
    }
    manager = new CitationSessionManager(mockPrisma as unknown as PrismaClient)
    vi.clearAllMocks()
  })

  describe('createEmitter', () => {
    it('should create an emitter with offset 0 if no citations exist', async () => {
      mockPrisma.citation.aggregate.mockResolvedValue({ _max: { index: null } })
      const emitter = await manager.createEmitter('session-1')
      expect(mockPrisma.citation.aggregate).toHaveBeenCalledWith({
        where: { sessionId: 'session-1' },
        _max: { index: true }
      })
      // emitter.register() will start from 1
      expect(emitter.register({ type: 'chat', chatJid: 'test' })).toBe(1)
    })

    it('should create an emitter starting from max index', async () => {
      mockPrisma.citation.aggregate.mockResolvedValue({ _max: { index: 5 } })
      const emitter = await manager.createEmitter('session-1')
      expect(emitter.register({ type: 'chat', chatJid: 'test' })).toBe(6)
    })
  })

  describe('persist', () => {
    it('should do nothing if map is empty', async () => {
      const citations = new Map<number, CitationEntity>()
      await manager.persist('session-1', citations)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('should batch insert citations inside a transaction', async () => {
      const citations = new Map<number, CitationEntity>()
      citations.set(1, { type: 'chat', chatJid: 'test@s.whatsapp.net' })
      citations.set(2, { type: 'message', chatJid: 'test@s.whatsapp.net', messageId: 'msg-1' })

      await manager.persist('session-1', citations)

      expect(mockPrisma.$transaction).toHaveBeenCalled()
      expect(mockPrisma.citation.createMany).toHaveBeenCalledWith({
        data: [
          { sessionId: 'session-1', index: 1, type: 'chat', payload: JSON.stringify({ type: 'chat', chatJid: 'test@s.whatsapp.net' }) },
          { sessionId: 'session-1', index: 2, type: 'message', payload: JSON.stringify({ type: 'message', chatJid: 'test@s.whatsapp.net', messageId: 'msg-1' }) }
        ]
      })
    })
  })

  describe('resolve', () => {
    it('should return null if citation is not found', async () => {
      mockPrisma.citation.findUnique.mockResolvedValue(null)
      const result = await manager.resolve('session-1', 1)
      expect(result).toBeNull()
      expect(mockPrisma.citation.findUnique).toHaveBeenCalledWith({
        where: { sessionId_index: { sessionId: 'session-1', index: 1 } }
      })
    })

    it('should return parsed entity if found', async () => {
      mockPrisma.citation.findUnique.mockResolvedValue({
        id: 1, sessionId: 'session-1', index: 1, type: 'chat', payload: '{"type":"chat","chatJid":"test"}'
      })
      const result = await manager.resolve('session-1', 1)
      expect(result).toEqual({ type: 'chat', chatJid: 'test' })
    })

    it('should return null and log error if JSON is invalid', async () => {
      mockPrisma.citation.findUnique.mockResolvedValue({
        id: 1, sessionId: 'session-1', index: 1, type: 'chat', payload: 'invalid-json'
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await manager.resolve('session-1', 1)
      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('resolveAll', () => {
    it('should return empty map if no citations found', async () => {
      mockPrisma.citation.findMany.mockResolvedValue([])
      const result = await manager.resolveAll('session-1')
      expect(result.size).toBe(0)
    })

    it('should return map of parsed entities ordered by index', async () => {
      mockPrisma.citation.findMany.mockResolvedValue([
        { index: 1, payload: '{"type":"chat","chatJid":"test1"}' },
        { index: 2, payload: '{"type":"chat","chatJid":"test2"}' }
      ])
      const result = await manager.resolveAll('session-1')
      expect(result.size).toBe(2)
      expect(result.get(1)).toEqual({ type: 'chat', chatJid: 'test1' })
      expect(result.get(2)).toEqual({ type: 'chat', chatJid: 'test2' })
      expect(mockPrisma.citation.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1' },
        orderBy: { index: 'asc' }
      })
    })

    it('should ignore invalid payloads in resolveAll', async () => {
      mockPrisma.citation.findMany.mockResolvedValue([
        { index: 1, payload: '{"type":"chat","chatJid":"test1"}' },
        { index: 2, payload: 'invalid-json' }
      ])
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await manager.resolveAll('session-1')
      expect(result.size).toBe(1)
      expect(result.get(1)).toEqual({ type: 'chat', chatJid: 'test1' })
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })
})
