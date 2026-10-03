import { describe, it, expect, vi } from 'vitest'

// setup.ts globally mocks EmbeddingService — restore the real implementation
// for this file so the pause behaviour can actually be exercised.
vi.mock('../../../services/search/EmbeddingService', async (importOriginal) => {
  return (await importOriginal()) as object
})

import { EmbeddingService } from '../../../services/search/EmbeddingService'

describe('EmbeddingService pause mid-drain (S11-04)', () => {
  it('stops processing the queue when setPaused(true) arrives mid-drain', async () => {
    const upsertVector = vi.fn().mockResolvedValue(undefined)
    const vectorRepo = {
      upsertVector,
      deleteFromVecMessages: vi.fn().mockResolvedValue(undefined),
      insertIntoVecMessages: vi.fn().mockResolvedValue(undefined)
    } as never

    let calls = 0
    const service = new EmbeddingService(vectorRepo, {} as never, {
      setModel: vi.fn(),
      ensureWorker: vi.fn().mockResolvedValue(undefined),
      embed: vi.fn().mockImplementation(async () => {
        calls++
        if (calls === 1) service.setPaused(true) // pause after the first embed
        return [0.1, 0.2]
      }),
      setOnActiveStateSync: vi.fn()
    } as never)

    await service.indexMessage('m1', 'one')
    await service.indexMessage('m2', 'two')
    await new Promise((r) => setTimeout(r, 50))

    expect(upsertVector).toHaveBeenCalledTimes(1)
    expect(upsertVector).toHaveBeenCalledWith('m1', expect.any(String))
  })
})

describe('EmbeddingService.indexAll failure surfacing (B-APP-04)', () => {
  const makeService = (vecInsert: () => Promise<void>, embed: () => Promise<number[]>): EmbeddingService =>
    new EmbeddingService(
      {
        getAllIndexedMessageIds: vi.fn().mockResolvedValue([]),
        upsertVector: vi.fn().mockResolvedValue(undefined),
        deleteFromVecMessages: vi.fn().mockResolvedValue(undefined),
        insertIntoVecMessages: vi.fn().mockImplementation(vecInsert)
      } as never,
      {
        findMessagesWithTextContent: vi.fn().mockResolvedValue([
          { id: 'm1', textContent: 'one' },
          { id: 'm2', textContent: 'two' }
        ])
      } as never,
      {
        setModel: vi.fn(),
        ensureWorker: vi.fn().mockResolvedValue(undefined),
        embed: vi.fn().mockImplementation(embed),
        setOnActiveStateSync: vi.fn()
      } as never
    )

  it('rejects when per-message indexing fails (vec0 insert error)', async () => {
    const service = makeService(
      () => Promise.reject(new Error('vec0 insert failed')),
      () => Promise.resolve([0.1])
    )
    await expect(service.indexAll()).rejects.toThrow(/failing/i)
  })

  it('rejects when the run is aborted mid-way because the worker died', async () => {
    const service = makeService(
      () => Promise.resolve(),
      () => Promise.reject(new Error('embedding worker exited'))
    )
    await expect(service.indexAll()).rejects.toThrow(/worker/i)
  })

  it('resolves when every message indexes', async () => {
    const service = makeService(() => Promise.resolve(), () => Promise.resolve([0.1]))
    await expect(service.indexAll()).resolves.toBeUndefined()
  })
})
