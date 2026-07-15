import { describe, it, expect, vi, beforeEach, Mocked, afterEach } from 'vitest'
import { HistorySyncManager, HistorySyncDependencies } from '../../../services/whatsapp/HistorySyncManager'
import { handleHistorySync } from '../../../historySync'

vi.mock('../../../historySync', () => ({
  handleHistorySync: vi.fn()
}))

describe('HistorySyncManager', () => {
  let mockDeps: Mocked<HistorySyncDependencies>
  let mockAuthSettings: any
  let mockWindow: any
  let manager: HistorySyncManager

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

    mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: vi.fn() }
    }

    vi.mocked(handleHistorySync).mockResolvedValue({ importedMessages: [] } as any)

    manager = new HistorySyncManager(mockDeps, () => mockWindow, mockAuthSettings)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('handleSyncChunk should process chunk, update progress, and handle timeout', async () => {
    const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
    const data = { progress: 50, syncType: 3 } // SYNC_TYPE_RECENT

    await manager.handleSyncChunk(data, true, sock)

    expect(mockDeps.embeddingService.setPaused).toHaveBeenCalledWith(true)
    expect(mockDeps.mediaService.setFavoriteStickerQueuePaused).toHaveBeenCalledWith(true)
    expect(handleHistorySync).toHaveBeenCalled()
    expect(mockDeps.mediaService.downloadFavoriteStickersFromSync).toHaveBeenCalled()
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('wa-sync-progress', expect.any(Object))
  })

  it('finishSync should unpause services, save status and emit complete', async () => {
    const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any

    await manager.finishSync(sock, true)

    expect(mockDeps.groupHydrationService.hydrateGroups).toHaveBeenCalled()
    expect(mockDeps.identityReconciliationService.deduplicateIdentities).toHaveBeenCalled()
    expect(mockDeps.contactService.clearCaches).toHaveBeenCalled()
    expect(mockDeps.embeddingService.setPaused).toHaveBeenCalledWith(false)
    expect(mockDeps.mediaService.setFavoriteStickerQueuePaused).toHaveBeenCalledWith(false)
    expect(mockAuthSettings.setHistorySyncCompleted).toHaveBeenCalled()
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('wa-sync-complete')
  })

  it('skipSync should complete sync using saved settings', async () => {
    const sock = { groupFetchAllParticipating: vi.fn().mockResolvedValue([]) } as any
    await manager.skipSync(sock)
    expect(mockAuthSettings.getSyncFullHistory).toHaveBeenCalled()
    expect(mockDeps.embeddingService.setPaused).toHaveBeenCalledWith(false)
    expect(mockAuthSettings.setHistorySyncCompleted).toHaveBeenCalled()
  })

  it('clear should reset state', () => {
    manager.setInProgress(true)
    manager.clear()
    expect(manager.isInProgress).toBe(false)
    expect(mockDeps.mediaService.clearFavoriteStickerQueue).toHaveBeenCalled()
  })
})
