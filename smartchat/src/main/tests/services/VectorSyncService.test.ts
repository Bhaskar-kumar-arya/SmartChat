import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.unmock('../../services/search/VectorSyncService')

import { VectorSyncService } from '../../services/search/VectorSyncService'
import { IMessageVectorRepository } from '../../services/messages/IMessageVectorRepository'

describe('VectorSyncService', () => {
  let service: VectorSyncService
  let repo: import('vitest').Mocked<IMessageVectorRepository>

  beforeEach(() => {
    repo = {
      getAllVectors: vi.fn(),
      deleteVector: vi.fn().mockResolvedValue(undefined),
      deleteFromVecMessages: vi.fn(),
      insertIntoVecMessages: vi.fn(),
    } as any

    service = new VectorSyncService(repo)
  })

  it('syncs valid vectors', async () => {
    const validVector = Array(768).fill(0.1)
    repo.getAllVectors.mockResolvedValue([
      { messageId: 'm1', vector: JSON.stringify(validVector) }
    ])

    await service.sync()

    expect(repo.deleteFromVecMessages).toHaveBeenCalledWith('m1')
    expect(repo.insertIntoVecMessages).toHaveBeenCalledWith('m1', JSON.stringify(validVector))
  })

  it('deletes invalid length vectors', async () => {
    const invalidVector = Array(100).fill(0.1)
    repo.getAllVectors.mockResolvedValue([
      { messageId: 'm2', vector: JSON.stringify(invalidVector) }
    ])

    await service.sync()

    expect(repo.deleteVector).toHaveBeenCalledWith('m2')
    expect(repo.deleteFromVecMessages).not.toHaveBeenCalled()
    expect(repo.insertIntoVecMessages).not.toHaveBeenCalled()
  })

  it('handles invalid JSON gracefully', async () => {
    repo.getAllVectors.mockResolvedValue([
      { messageId: 'm3', vector: '{ invalid json' }
    ])

    await service.sync()
    
    // Should catch the error and continue, not throwing up to the caller
    expect(repo.deleteFromVecMessages).not.toHaveBeenCalled()
  })
})
