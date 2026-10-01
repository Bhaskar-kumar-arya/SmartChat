import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Boom } from '@hapi/boom'
import { WorkerConnectionHandler } from '../../../../workers/whatsapp/socket/workerConnectionHandler'
import { RECONNECT_DELAY_DEFAULT_MS, RECONNECT_DELAY_MAX_MS } from '../../../../constants'

/**
 * Pass-2 Slice 1 regressions.
 *
 * P2-S1-02: a 440/409 "conflict" close (WhatsApp opened on another desktop) only
 *           logged "Standing down" — no domain event, so the renderer could not
 *           show a reconnect CTA. It must publish `wa-session-replaced`.
 * P2-S1-03: every close-with-reconnect used a fixed RECONNECT_DELAY_DEFAULT_MS,
 *           so a server-side close loop produced a tight fixed-interval reconnect
 *           loop. Consecutive close-without-open events must grow the delay
 *           exponentially, capped at RECONNECT_DELAY_MAX_MS, and reset after an
 *           `open`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeHandler(publish: any, onReconnect: any, onWipeAndConnect: any = () => {}) {
  return new WorkerConnectionHandler(
    { publish } as any,
    () => null, // reposGetter
    () => null, // sockGetter
    () => false, // getSyncFullHistory
    () => false, // getIsFreshLogin
    () => {}, // setIsFreshLogin
    onReconnect,
    onWipeAndConnect
  )
}

function closeUpdate(statusCode: number, data?: unknown): Record<string, unknown> {
  return {
    connection: 'close',
    lastDisconnect: { error: new Boom('closed', { statusCode, data }) }
  }
}

// Baileys builds the close error as `new Boom('Stream Errored (conflict)',
// { statusCode, data: <the <conflict type=.../> child node> })`.
const conflictNode = (type: string): Record<string, unknown> => ({ tag: 'conflict', attrs: { type } })

describe('WorkerConnectionHandler — P2-S1-02 conflict close', () => {
  let publish: ReturnType<typeof vi.fn>
  let onReconnect: ReturnType<typeof vi.fn>
  let handler: WorkerConnectionHandler

  beforeEach(() => {
    publish = vi.fn()
    onReconnect = vi.fn()
    handler = makeHandler(publish, onReconnect)
  })

  it('publishes wa-session-replaced on a 440 conflict and does not reconnect', async () => {
    await handler.handleConnectionUpdate(closeUpdate(440))
    expect(publish).toHaveBeenCalledWith('wa-session-replaced')
    expect(onReconnect).not.toHaveBeenCalled()
  })

  it('publishes wa-session-replaced on a 409 conflict', async () => {
    await handler.handleConnectionUpdate(closeUpdate(409))
    expect(publish).toHaveBeenCalledWith('wa-session-replaced')
  })

  it('does not publish wa-session-replaced on an ordinary transient close', async () => {
    await handler.handleConnectionUpdate(closeUpdate(500))
    expect(publish).not.toHaveBeenCalledWith('wa-session-replaced')
    expect(onReconnect).toHaveBeenCalled()
  })
})

describe('WorkerConnectionHandler — H-02 unlink from phone (401 + conflict/device_removed)', () => {
  let publish: ReturnType<typeof vi.fn>
  let onReconnect: ReturnType<typeof vi.fn>
  let onWipe: ReturnType<typeof vi.fn>
  let handler: WorkerConnectionHandler

  beforeEach(() => {
    publish = vi.fn()
    onReconnect = vi.fn()
    onWipe = vi.fn()
    handler = makeHandler(publish, onReconnect, onWipe)
  })

  it('plain 401 logged-out wipes and publishes wa-logged-out', async () => {
    await handler.handleConnectionUpdate(closeUpdate(401))
    expect(publish).toHaveBeenCalledWith('wa-logged-out')
    expect(onWipe).toHaveBeenCalledTimes(1)
    expect(onReconnect).not.toHaveBeenCalled()
  })

  it('440 conflict type=replaced still stands down without wiping', async () => {
    await handler.handleConnectionUpdate(closeUpdate(440, conflictNode('replaced')))
    expect(publish).toHaveBeenCalledWith('wa-session-replaced')
    expect(publish).not.toHaveBeenCalledWith('wa-logged-out')
    expect(onWipe).not.toHaveBeenCalled()
  })

  // Real-world log: statusCode=401, data.tag='conflict', type='device_removed'.
  // Was misclassified as "session replaced" so no wipe / fresh QR happened.
  it('treats 401 + conflict type=device_removed as logged out: wipes, no session-replaced', async () => {
    await handler.handleConnectionUpdate(closeUpdate(401, conflictNode('device_removed')))
    expect(publish).toHaveBeenCalledWith('wa-logged-out')
    expect(publish).not.toHaveBeenCalledWith('wa-session-replaced')
    expect(onWipe).toHaveBeenCalledTimes(1)
    expect(onReconnect).not.toHaveBeenCalled()
  })
})

describe('WorkerConnectionHandler — P2-S1-03 reconnect backoff', () => {
  let publish: ReturnType<typeof vi.fn>
  let onReconnect: ReturnType<typeof vi.fn>
  let handler: WorkerConnectionHandler

  beforeEach(() => {
    publish = vi.fn()
    onReconnect = vi.fn()
    handler = makeHandler(publish, onReconnect)
  })

  it('grows the delay exponentially on consecutive close-without-open, capped at the ceiling', async () => {
    for (let i = 0; i < 8; i++) {
      await handler.handleConnectionUpdate(closeUpdate(500))
    }
    const delays = onReconnect.mock.calls.map((c) => c[0])
    expect(delays[0]).toBe(RECONNECT_DELAY_DEFAULT_MS)
    expect(delays[1]).toBe(RECONNECT_DELAY_DEFAULT_MS * 2)
    expect(delays[2]).toBe(RECONNECT_DELAY_DEFAULT_MS * 4)
    // each step at least doubles until the ceiling
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
      expect(delays[i]).toBeLessThanOrEqual(RECONNECT_DELAY_MAX_MS)
    }
    expect(delays[delays.length - 1]).toBe(RECONNECT_DELAY_MAX_MS)
  })

  it('resets the backoff to base after a connection open', async () => {
    await handler.handleConnectionUpdate(closeUpdate(500))
    await handler.handleConnectionUpdate(closeUpdate(500))
    await handler.handleConnectionUpdate({ connection: 'open' })
    onReconnect.mockClear()

    await handler.handleConnectionUpdate(closeUpdate(500))
    expect(onReconnect).toHaveBeenLastCalledWith(RECONNECT_DELAY_DEFAULT_MS)
  })
})
