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
