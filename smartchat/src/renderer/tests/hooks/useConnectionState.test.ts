import { describe, it, expect } from 'vitest'
import {
  connectionReducer,
  initialConnectionState,
  INITIAL_SYNC_STATUS,
  SESSION_REPLACED_STATUS,
  type ConnectionAction,
  type ConnectionState
} from '@renderer/hooks/useConnectionState'

const run = (actions: ConnectionAction[], from: ConnectionState = initialConnectionState): ConnectionState =>
  actions.reduce(connectionReducer, from)

const ready = (): ConnectionState => run([{ type: 'syncComplete' }])

describe('connectionReducer', () => {
  it('starts initializing', () => {
    expect(initialConnectionState).toMatchObject({
      phase: 'initializing',
      syncStatus: INITIAL_SYNC_STATUS,
      sessionReplaced: false,
      reconnecting: false
    })
  })

  it('qr -> phase qr, stores the code', () => {
    const s = run([{ type: 'qr', qr: 'abc' }])
    expect(s).toMatchObject({ phase: 'qr', qr: 'abc' })
  })

  it('connected (fresh) -> syncing at 0%; connected (catch-up) -> connected phase', () => {
    expect(run([{ type: 'connected', isCatchup: false }])).toMatchObject({ phase: 'syncing', syncProgress: 0 })
    expect(run([{ type: 'connected', isCatchup: true }])).toMatchObject({ phase: 'connected' })
  })

  it('connected clears the qr', () => {
    expect(run([{ type: 'qr', qr: 'x' }, { type: 'connected', isCatchup: false }]).qr).toBeNull()
  })

  it('syncProgress enters syncing from any pre-ready phase', () => {
    const s = run([{ type: 'syncProgress', progress: 42, syncType: 3 }])
    expect(s).toMatchObject({ phase: 'syncing', syncProgress: 42, syncType: 3 })
  })

  it('syncComplete -> ready at 100%', () => {
    expect(ready()).toMatchObject({ phase: 'ready', syncProgress: 100, reconnecting: false })
  })

  it('syncStatus only updates the status line', () => {
    const s = run([{ type: 'syncStatus', status: 'hi' }])
    expect(s).toEqual({ ...initialConnectionState, syncStatus: 'hi' })
  })

  it('loggedOut resets to initializing from any phase', () => {
    const s = run(
      [
        { type: 'syncProgress', progress: 50, syncType: 6 },
        { type: 'syncStatus', status: 'x' },
        { type: 'loggedOut' }
      ]
    )
    expect(s).toEqual(initialConnectionState)
  })

  describe('ready is kept (B-UIAPP-04)', () => {
    it('catch-up reconnect keeps ready and flags reconnecting', () => {
      const s = connectionReducer(ready(), { type: 'connected', isCatchup: true })
      expect(s).toMatchObject({ phase: 'ready', reconnecting: true })
    })

    it('non-catch-up reconnect keeps ready and flags reconnecting', () => {
      const s = connectionReducer(ready(), { type: 'connected', isCatchup: false })
      expect(s).toMatchObject({ phase: 'ready', reconnecting: true, syncProgress: 100 })
    })

    it('late syncProgress is ignored once ready', () => {
      const r = ready()
      expect(connectionReducer(r, { type: 'syncProgress', progress: 10, syncType: 3 })).toBe(r)
    })

    it('syncComplete ends the reconnecting flag', () => {
      const s = run([{ type: 'connected', isCatchup: true }, { type: 'syncComplete' }], ready())
      expect(s).toMatchObject({ phase: 'ready', reconnecting: false })
    })

    it('logout, qr and sessionReplaced while reconnecting leave ready and clear the flag', () => {
      const reconnecting = connectionReducer(ready(), { type: 'connected', isCatchup: true })
      for (const a of [
        { type: 'loggedOut' },
        { type: 'qr', qr: 'q' },
        { type: 'sessionReplaced' }
      ] as ConnectionAction[]) {
        const s = connectionReducer(reconnecting, a)
        expect(s.phase).not.toBe('ready')
        expect(s.reconnecting).toBe(false)
      }
    })
  })

  describe('sessionReplaced', () => {
    const replaced = (): ConnectionState => run([{ type: 'sessionReplaced' }])

    it('sets the flag, status line and initializing phase', () => {
      expect(replaced()).toMatchObject({
        sessionReplaced: true,
        phase: 'initializing',
        syncStatus: SESSION_REPLACED_STATUS
      })
    })

    it.each<ConnectionAction>([
      { type: 'loggedOut' },
      { type: 'qr', qr: 'q' },
      { type: 'connected', isCatchup: true },
      { type: 'connected', isCatchup: false },
      { type: 'syncComplete' }
    ])('is cleared by %o', (action) => {
      expect(connectionReducer(replaced(), action).sessionReplaced).toBe(false)
    })

    it('survives status updates', () => {
      expect(connectionReducer(replaced(), { type: 'syncStatus', status: 's' }).sessionReplaced).toBe(true)
    })
  })
})
