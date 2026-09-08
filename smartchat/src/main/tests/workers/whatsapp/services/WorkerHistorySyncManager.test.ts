import { describe, it, expect, vi, beforeEach, afterEach, Mocked } from 'vitest'
import {
  WorkerHistorySyncManager,
  HistorySyncDependencies
} from '../../../../workers/whatsapp/services/WorkerHistorySyncManager'
import { handleHistorySync } from '../../../../historySync'

vi.mock('../../../../historySync', () => ({
  handleHistorySync: vi.fn()
}))

describe('WorkerHistorySyncManager (S3-03)', () => {
  let mockDeps: Mocked<HistorySyncDependencies>
  let mockAuthSettings: any
  let mockPublisher: any
  let manager: WorkerHistorySyncManager

  beforeEach(() => {
    mockDeps = {
      mediaService: {
        setFavoriteStickerQueuePaused: vi.fn(),
        clearFavoriteStickerQueue: vi.fn(),
        downloadFavoriteStickersFromSync: vi.fn().mockResolvedValue(undefined)
      } as any,
      embeddingService: { setPaused: vi.fn() } as any,
      contactService: { clearCaches: vi.fn() } as any,
      aliasRepository: {} as any,
      chatRepository: {} as any,
      communityRepository: {} as any,
      messageRepository: {} as any,
      reactionRepository: {} as any,
      groupHydrationService: { hydrateGroups: vi.fn().mockResolvedValue(undefined) } as any,
      identityReconciliationService: { deduplicateIdentities: vi.fn().mockResolvedValue(undefined) } as any
    }
    mockAuthSettings = {
      setHistorySyncCompleted: vi.fn().mockResolvedValue(undefined),
      getSyncFullHistory: vi.fn().mockResolvedValue(true)
    }
    mockPublisher = { publish: vi.fn() }
    vi.mocked(handleHistorySync).mockResolvedValue({ importedMessages: [] } as any)
    manager = new WorkerHistorySyncManager(mockDeps, mockAuthSettings, mockPublisher)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('defers finishSync while a chunk is still writing, then runs it once settled', async () => {
    const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
    let resolveSync: (v: any) => void = () => {}
    vi.mocked(handleHistorySync).mockReturnValue(new Promise(r => { resolveSync = r }) as any)

    const chunkPromise = manager.handleSyncChunk({ progress: 10, syncType: 3 }, true, sock)

    await manager.finishSync(sock, true)
    expect(mockDeps.identityReconciliationService.deduplicateIdentities).not.toHaveBeenCalled()
    expect(mockAuthSettings.setHistorySyncCompleted).not.toHaveBeenCalled()
    expect(manager.isComplete).toBe(false)

    resolveSync({ importedMessages: [] })
    await chunkPromise

    expect(mockDeps.identityReconciliationService.deduplicateIdentities).toHaveBeenCalled()
    expect(mockAuthSettings.setHistorySyncCompleted).toHaveBeenCalled()
    expect(manager.isComplete).toBe(true)
  })

  it('re-arms the inactivity timer after a chunk and fires finishSync in the gap', async () => {
    const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any

    await manager.handleSyncChunk({ progress: 10, syncType: 3 }, true, sock)
    expect(mockAuthSettings.setHistorySyncCompleted).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(180_000)
    expect(mockAuthSettings.setHistorySyncCompleted).toHaveBeenCalled()
  })

  // P2-S1-04: skipSync/finishSync reply {status:'success'} unconditionally even
  // when completion was only deferred (activeChunks > 0). They must report a
  // distinct 'deferred' result so the command router can surface it.
  it("P2-S1-04: finishSync returns 'deferred' while a chunk is writing, 'completed' otherwise", async () => {
    const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
    let resolveSync: (v: any) => void = () => {}
    vi.mocked(handleHistorySync).mockReturnValue(new Promise((r) => { resolveSync = r }) as any)

    const chunkPromise = manager.handleSyncChunk({ progress: 10, syncType: 3 }, true, sock)

    await expect(manager.finishSync(sock, true)).resolves.toBe('deferred')

    resolveSync({ importedMessages: [] })
    await chunkPromise

    expect(manager.isComplete).toBe(true)
    await expect(manager.finishSync(sock, true)).resolves.toBe('completed')
  })

  it("P2-S1-04: skipSync returns 'completed' when no chunk is in flight", async () => {
    const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
    await expect(manager.skipSync(sock)).resolves.toBe('completed')
  })

  it("P2-S1-04: skipSync returns 'deferred' when a chunk is still writing", async () => {
    const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
    let resolveSync: (v: any) => void = () => {}
    vi.mocked(handleHistorySync).mockReturnValue(new Promise((r) => { resolveSync = r }) as any)

    const chunkPromise = manager.handleSyncChunk({ progress: 10, syncType: 3 }, true, sock)
    await expect(manager.skipSync(sock)).resolves.toBe('deferred')

    resolveSync({ importedMessages: [] })
    await chunkPromise
  })
})
