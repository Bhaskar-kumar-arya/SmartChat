import { describe, it, expect, vi, beforeEach, Mocked, afterEach } from 'vitest'
import { WACatchUpManager } from '../../../services/whatsapp/WACatchUpManager'
import { IEmbeddingOperationalControl } from '../../../services/search/IEmbeddingService'
import { IAuthSettingsService } from '../../../services/auth/IAuthSettingsService'

describe('WACatchUpManager', () => {
  let mockEmbeddingService: Mocked<IEmbeddingOperationalControl>
  let mockAuthSettingsService: Mocked<IAuthSettingsService>
  let mockWindow: any
  let manager: WACatchUpManager

  beforeEach(() => {
    mockEmbeddingService = {
      setPaused: vi.fn(),
      setWorkerPath: vi.fn(),
      setWorkerDBPath: vi.fn(),
      initWorker: vi.fn(),
      shutdownWorker: vi.fn()
    } as any

    mockAuthSettingsService = {
      getSyncFullHistory: vi.fn().mockResolvedValue(true)
    } as any

    mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn()
      }
    }

    manager = new WACatchUpManager(mockEmbeddingService, mockAuthSettingsService)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('start should set waiting flag, pause embedding, and start timeout', () => {
    manager.setWindow(mockWindow)
    manager.start(true)

    expect(manager.isWaiting()).toBe(true)
    expect(mockEmbeddingService.setPaused).toHaveBeenCalledWith(true)
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('wa-sync-status', 'Syncing missed messages...')
  })

  it('handleUpdate should set hasReceivedPending', async () => {
    await manager.handleUpdate({ receivedPendingNotifications: true })
    expect(manager.hasReceivedPending()).toBe(true)
  })

  it('handleUpdate should complete catch-up when receivedPendingNotifications is true and is waiting', async () => {
    manager.setWindow(mockWindow)
    manager.start(true)
    
    await manager.handleUpdate({ receivedPendingNotifications: true })

    // Promise tick needed since handleUpdate awaits getSyncFullHistory
    await Promise.resolve()

    expect(manager.isWaiting()).toBe(false)
    expect(mockEmbeddingService.setPaused).toHaveBeenCalledWith(false)
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('wa-sync-progress', {
      progress: 100,
      syncType: 6,
      syncFullHistory: true
    })
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('wa-sync-complete')
  })

  it('timeout should complete catch-up', () => {
    manager.setWindow(mockWindow)
    manager.start(true)
    
    vi.advanceTimersByTime(30000)

    expect(manager.isWaiting()).toBe(false)
    expect(mockEmbeddingService.setPaused).toHaveBeenCalledWith(false)
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('wa-sync-complete')
  })

  it('reset should clear flags and timeout', () => {
    manager.start(true)
    manager.reset()
    expect(manager.isWaiting()).toBe(false)
  })
})
