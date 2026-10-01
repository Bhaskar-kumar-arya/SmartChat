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
  describe('ON_DEMAND chunks (B-WA-06 / B-WA-16)', () => {
    const ON_DEMAND = 6
    const makeSock = () => ({ groupFetchAllParticipating: vi.fn().mockResolvedValue([]) }) as any

    // B-WA-06
    it('B-WA-06: finishSync deferred by an in-flight initial chunk still completes when an on-demand chunk settles last', async () => {
      const sock = makeSock()
      let resolveInitial: (v: any) => void = () => {}
      let resolveOnDemand: (v: any) => void = () => {}
      vi.mocked(handleHistorySync)
        .mockReturnValueOnce(new Promise((r) => { resolveInitial = r }) as any)
        .mockReturnValueOnce(new Promise((r) => { resolveOnDemand = r }) as any)

      const initial = manager.handleSyncChunk({ progress: 10, syncType: 3 }, true, sock)
      const onDemand = manager.handleSyncChunk({ syncType: ON_DEMAND, chats: [] }, true, sock)
      await expect(manager.finishSync(sock, true)).resolves.toBe('deferred')

      resolveInitial({ importedMessages: [] })
      await initial
      resolveOnDemand({ importedMessages: [], messageCount: 1 })
      await onDemand

      expect(mockAuthSettings.setHistorySyncCompleted).toHaveBeenCalled()
      expect(manager.isComplete).toBe(true)
    })

    // B-WA-06
    it('B-WA-06: an in-flight on-demand page does not defer finishSync', async () => {
      const sock = makeSock()
      vi.mocked(handleHistorySync).mockReturnValue(new Promise(() => {}) as any)
      void manager.handleSyncChunk({ syncType: ON_DEMAND, chats: [] }, true, sock)
      await expect(manager.finishSync(sock, true)).resolves.toBe('completed')
    })

    // B-WA-16
    it('B-WA-16: a failing on-demand page still publishes wa-history-appended with an error', async () => {
      vi.mocked(handleHistorySync).mockRejectedValue(new Error('db locked'))
      await manager.handleSyncChunk({ syncType: ON_DEMAND, chats: [{ id: 'a@s.whatsapp.net' }] }, true, makeSock())
      expect(mockPublisher.publish).toHaveBeenCalledWith(
        'wa-history-appended',
        expect.objectContaining({ jid: 'a@s.whatsapp.net', messageCount: 0, error: 'db locked' })
      )
    })

    // B-WA-16
    it('B-WA-16: the success payload carries jid and requestId', async () => {
      vi.mocked(handleHistorySync).mockResolvedValue({ importedMessages: [], messageCount: 3 } as any)
      await manager.handleSyncChunk(
        { syncType: ON_DEMAND, chats: [{ id: 'a@s.whatsapp.net' }], peerDataRequestSessionId: 'req-1' },
        true,
        makeSock()
      )
      expect(mockPublisher.publish).toHaveBeenCalledWith('wa-history-appended', {
        jid: 'a@s.whatsapp.net',
        requestId: 'req-1',
        messageCount: 3
      })
    })

    it('an on-demand page never touches initial-sync state (no pause, no progress, no timer)', async () => {
      vi.mocked(handleHistorySync).mockResolvedValue({ importedMessages: [], messageCount: 2 } as any)
      await manager.handleSyncChunk({ syncType: ON_DEMAND, chats: [] }, true, makeSock())
      expect(mockDeps.embeddingService.setPaused).not.toHaveBeenCalled()
      expect(mockPublisher.publish).not.toHaveBeenCalledWith('wa-sync-progress', expect.anything())
      await vi.advanceTimersByTimeAsync(200_000)
      expect(mockAuthSettings.setHistorySyncCompleted).not.toHaveBeenCalled()
    })
  })

  describe('armInactivityTimer (B-WA-11)', () => {
    it('finishes an incomplete sync after the inactivity window when no chunk ever arrives', async () => {
      const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
      manager.armInactivityTimer(sock, true)
      await vi.advanceTimersByTimeAsync(179_999)
      expect(mockAuthSettings.setHistorySyncCompleted).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(mockAuthSettings.setHistorySyncCompleted).toHaveBeenCalled()
    })

    it('is a no-op once the sync is complete', async () => {
      const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
      await manager.finishSync(sock, true)
      mockAuthSettings.setHistorySyncCompleted.mockClear()
      manager.armInactivityTimer(sock, true)
      await vi.advanceTimersByTimeAsync(200_000)
      expect(mockAuthSettings.setHistorySyncCompleted).not.toHaveBeenCalled()
    })

    it('does not run while a chunk is writing (the chunk re-arms in its finally)', async () => {
      const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
      let resolveSync: (v: any) => void = () => {}
      vi.mocked(handleHistorySync).mockReturnValue(new Promise((r) => { resolveSync = r }) as any)
      const chunk = manager.handleSyncChunk({ progress: 10, syncType: 3 }, true, sock)
      manager.armInactivityTimer(sock, true)
      await vi.advanceTimersByTimeAsync(200_000)
      expect(mockAuthSettings.setHistorySyncCompleted).not.toHaveBeenCalled()
      resolveSync({ importedMessages: [] })
      await chunk
    })
  })
})
