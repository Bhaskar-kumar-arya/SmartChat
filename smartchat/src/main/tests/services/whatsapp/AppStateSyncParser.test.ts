import { describe, it, expect, vi } from 'vitest'
import { AppStateSyncParser } from '../../../services/whatsapp/AppStateSyncParser'
import type { IWAEventBus } from '../../../services/whatsapp/IWAEventBus'
import type { WASocket } from '../../../services/whatsapp/types'

function makeBus() {
  const emit = vi.fn().mockResolvedValue(undefined)
  return { emit, on: vi.fn(), off: vi.fn(), removeAllListeners: vi.fn() } as unknown as IWAEventBus & { emit: ReturnType<typeof vi.fn> }
}

function muteSyncAction(muteAction: Record<string, unknown>) {
  return {
    index: ['mute', '123456@s.whatsapp.net'],
    syncAction: { value: { muteAction } }
  }
}

describe('AppStateSyncParser.handleMute (P2-S3-02)', () => {
  const sock = {} as WASocket

  it('emits chat:updated muteExpiration as a plain number for a timed mute', async () => {
    const bus = makeBus()
    await AppStateSyncParser.parseAndDispatch(
      muteSyncAction({ muted: true, muteEndTimestamp: '1893456000' }),
      sock,
      bus
    )
    const chatUpdated = bus.emit.mock.calls.find((c) => c[0] === 'chat:updated')
    expect(chatUpdated).toBeTruthy()
    const value = chatUpdated![1].update.muteExpiration
    expect(typeof value).toBe('number')
    expect(value).toBe(1893456000)
  })

  it('emits a plain-number sentinel for an indefinite mute', async () => {
    const bus = makeBus()
    await AppStateSyncParser.parseAndDispatch(
      muteSyncAction({ muted: true }),
      sock,
      bus
    )
    const chatUpdated = bus.emit.mock.calls.find((c) => c[0] === 'chat:updated')!
    expect(typeof chatUpdated[1].update.muteExpiration).toBe('number')
    expect(chatUpdated[1].update.muteExpiration).toBe(-1)
  })

  it('emits number 0 on unmute', async () => {
    const bus = makeBus()
    await AppStateSyncParser.parseAndDispatch(
      muteSyncAction({ muted: false }),
      sock,
      bus
    )
    const chatUpdated = bus.emit.mock.calls.find((c) => c[0] === 'chat:updated')!
    expect(typeof chatUpdated[1].update.muteExpiration).toBe('number')
    expect(chatUpdated[1].update.muteExpiration).toBe(0)
  })
})
