import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WhatsAppConnectionManager } from '../../../services/whatsapp/WhatsAppConnectionManager'
import { createSubscribers } from '../../../services/whatsapp/subscribers'

/**
 * P2-S13-05: `connect()` created a fresh set of subscribers on every
 * connect/reconnect but only ever tore down via `bus.removeAllListeners()` — the
 * returned array was discarded and `subscriber.dispose()` was never called. Any
 * subscriber holding a non-bus resource (timer, fs.watch, app/ipcMain listener)
 * would leak one instance per reconnect.
 */
vi.mock('../../../services/whatsapp/subscribers', () => ({
  createSubscribers: vi.fn()
}))

describe('WhatsAppConnectionManager subscriber disposal (P2-S13-05)', () => {
  let authSettingsService: any
  let chatRepository: any
  let bridge: any
  let mgr: WhatsAppConnectionManager
  const disposeSpies: Array<ReturnType<typeof vi.fn>> = []

  beforeEach(() => {
    disposeSpies.length = 0
    ;(createSubscribers as any).mockImplementation(() => {
      const dispose = vi.fn()
      disposeSpies.push(dispose)
      return [{ register: vi.fn(), dispose }]
    })

    authSettingsService = {
      hasCreds: vi.fn().mockResolvedValue(true),
      clearHistorySyncCompleted: vi.fn().mockResolvedValue(undefined),
      getHistorySyncCompleted: vi.fn().mockResolvedValue(true),
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

  it('disposes the previous connection subscribers on reconnect', async () => {
    await mgr.connect()
    expect(disposeSpies).toHaveLength(1)
    expect(disposeSpies[0]).not.toHaveBeenCalled()

    await mgr.connect()
    expect(disposeSpies[0]).toHaveBeenCalledTimes(1)
    expect(disposeSpies[1]).not.toHaveBeenCalled()
  })

  it('disposes subscribers on shutdown', async () => {
    await mgr.connect()
    await mgr.shutdown()
    expect(disposeSpies[0]).toHaveBeenCalledTimes(1)
  })
})
