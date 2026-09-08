import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WhatsAppConnectionManager } from '../../../services/whatsapp/WhatsAppConnectionManager'

/**
 * P2-S3-01: `isFreshLogin` was set true on a QR login but never reset, so every
 * later reconnect in the same process re-cleared `history_sync_completed` and
 * re-ran a full history sync.
 */
describe('WhatsAppConnectionManager fresh-login flag (P2-S3-01)', () => {
  let authSettingsService: any
  let chatRepository: any
  let bridge: any
  let mgr: WhatsAppConnectionManager

  beforeEach(() => {
    authSettingsService = {
      hasCreds: vi.fn(),
      clearHistorySyncCompleted: vi.fn().mockResolvedValue(undefined),
      getHistorySyncCompleted: vi.fn(),
      getSyncFullHistory: vi.fn().mockResolvedValue(false)
    }
    chatRepository = { countChats: vi.fn().mockResolvedValue(0) }
    bridge = {
      setUnexpectedExitHandler: vi.fn(),
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    mgr = new WhatsAppConnectionManager(
      { embeddingService: { setPaused: vi.fn() } } as never,
      authSettingsService as never,
      chatRepository as never,
      {} as never,
      (() => ({ on: vi.fn(), removeAllListeners: vi.fn() })) as never,
      bridge as never
    )
    mgr.setWindow({} as never)
  })

  it('does not re-run history sync on a reconnect after a fresh login', async () => {
    // Fresh QR login: no creds yet.
    authSettingsService.hasCreds.mockResolvedValue(false)
    authSettingsService.getHistorySyncCompleted.mockResolvedValue(false)
    await mgr.connect()
    expect(bridge.start).toHaveBeenLastCalledWith(false, true) // shouldSyncHistory = true
    const clearCallsAfterFresh = authSettingsService.clearHistorySyncCompleted.mock.calls.length

    // Later reconnect in the same process: creds now exist, history sync done.
    authSettingsService.hasCreds.mockResolvedValue(true)
    authSettingsService.getHistorySyncCompleted.mockResolvedValue(true)
    await mgr.connect()

    expect(bridge.start).toHaveBeenLastCalledWith(false, false) // shouldSyncHistory = false
    expect(authSettingsService.clearHistorySyncCompleted.mock.calls.length).toBe(clearCallsAfterFresh)
  })
})
