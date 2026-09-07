import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WhatsAppConnectionManager } from '../../../services/whatsapp/WhatsAppConnectionManager'

/**
 * S13-04: the WhatsApp worker had no supervision — a crash left WhatsApp
 * permanently dead until an app restart. The manager now registers an
 * unexpected-exit handler that drives a bounded, backed-off reconnect.
 */
describe('WhatsAppConnectionManager supervised reconnect (S13-04)', () => {
  let exitHandler: ((code: number) => void) | undefined
  let bridge: { setUnexpectedExitHandler: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }

  function makeManager() {
    bridge = {
      setUnexpectedExitHandler: vi.fn((h: (code: number) => void) => { exitHandler = h }),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    const mgr = new WhatsAppConnectionManager(
      { embeddingService: { setPaused: vi.fn() } } as never,
      {} as never,
      {} as never,
      {} as never,
      (() => ({})) as never,
      bridge as never
    )
    return mgr
  }

  beforeEach(() => { vi.useFakeTimers(); exitHandler = undefined })
  afterEach(() => { vi.useRealTimers() })

  it('registers an unexpected-exit handler on construction', () => {
    makeManager()
    expect(bridge.setUnexpectedExitHandler).toHaveBeenCalledOnce()
    expect(exitHandler).toBeTypeOf('function')
  })

  it('schedules a reconnect with backoff after an unexpected exit', async () => {
    const mgr = makeManager()
    const connectSpy = vi.spyOn(mgr, 'connect').mockResolvedValue(undefined)

    exitHandler!(1)
    expect(connectSpy).not.toHaveBeenCalled() // deferred
    await vi.advanceTimersByTimeAsync(2000)
    expect(connectSpy).toHaveBeenCalledTimes(1)
  })

  it('gives up after MAX_WORKER_RESTARTS attempts', async () => {
    const mgr = makeManager()
    const connectSpy = vi.spyOn(mgr, 'connect').mockResolvedValue(undefined)

    for (let i = 0; i < 10; i++) {
      exitHandler!(1)
      await vi.advanceTimersByTimeAsync(60_000)
    }
    expect(connectSpy).toHaveBeenCalledTimes(5)
  })
})
