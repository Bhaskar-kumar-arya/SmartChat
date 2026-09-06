import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageVectorRepository } from '../../services/messages/MessageVectorRepository'

/**
 * S2-03: searchVectorMatch silently dropped the `messageId IN (...)` scope
 * filter once `candidateIds.length >= 2000`, running an unscoped global vector
 * MATCH (wrong results / scope leak for deepSearch). The filter must always be
 * enforced — chunked for large candidate sets.
 */
describe('MessageVectorRepository.searchVectorMatch (S2-03)', () => {
  let prisma: any
  let repo: MessageVectorRepository
  let calls: Array<{ sql: string; params: unknown[] }>

  beforeEach(() => {
    calls = []
    prisma = {
      $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...params: unknown[]) => {
        calls.push({ sql, params })
        // Return one synthetic hit per candidate id in this chunk so we can
        // observe merge/re-rank behaviour.
        const ids = params.slice(1) as string[]
        return Promise.resolve(ids.map((id, i) => ({ messageId: id, distance: Number(id.replace(/\D/g, '')) || i })))
      })
    }
    repo = new MessageVectorRepository(prisma)
  })

  it('applies the IN filter for a small candidate set', async () => {
    await repo.searchVectorMatch('[0.1]', ['a', 'b', 'c'])
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('messageId IN (?,?,?)')
    expect(calls[0].params).toEqual(['[0.1]', 'a', 'b', 'c'])
  })

  it('never drops the filter for a large candidate set — it chunks instead', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => `m${i}`)
    await repo.searchVectorMatch('[0.1]', many)

    expect(calls.length).toBeGreaterThan(1)
    for (const c of calls) {
      expect(c.sql).toContain('messageId IN (')
      // queryVectorJson + at most CANDIDATE_CHUNK_SIZE ids
      expect(c.params.length).toBeLessThanOrEqual(1 + 900)
    }
    // all candidates covered exactly once
    const boundIds = calls.flatMap((c) => c.params.slice(1))
    expect(new Set(boundIds).size).toBe(2500)
  })

  it('merges and re-ranks chunked results down to the top K', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => `m${String(i).padStart(4, '0')}`)
    const out = await repo.searchVectorMatch('[0.1]', many)
    expect(out.length).toBe(30)
    const distances = out.map((r) => r.distance)
    expect([...distances]).toEqual([...distances].sort((a, b) => a - b))
  })

  it('runs an unfiltered query only when no candidateIds are supplied', async () => {
    await repo.searchVectorMatch('[0.1]')
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).not.toContain('messageId IN')
    expect(calls[0].params).toEqual(['[0.1]'])
  })
})
