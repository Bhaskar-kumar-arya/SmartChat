import { describe, it, expect, vi, beforeEach } from 'vitest'
import { navigate, subscribeNavigation, __resetNavigationBus } from '@renderer/utils/navigationBus'

describe('navigationBus (F12-02)', () => {
  beforeEach(() => {
    __resetNavigationBus()
  })

  it('replays the last intent to a listener that mounts after dispatch', () => {
    navigate({ jid: 'a@s.whatsapp.net', targetMessageId: 'm1' })

    const seen: unknown[] = []
    subscribeNavigation((i) => seen.push(i))

    expect(seen).toEqual([{ jid: 'a@s.whatsapp.net', targetMessageId: 'm1' }])
  })

  it('delivers live intents to a mounted listener and does not double-replay', () => {
    const seen: unknown[] = []
    const unsub = subscribeNavigation((i) => seen.push(i))

    navigate({ jid: 'b@s.whatsapp.net' })
    expect(seen).toHaveLength(1)

    unsub()
    navigate({ jid: 'c@s.whatsapp.net' })
    expect(seen).toHaveLength(1)
  })

  it('de-dupes identical back-to-back intents', () => {
    const seen: unknown[] = []
    subscribeNavigation((i) => seen.push(i))

    navigate({ jid: 'd@s.whatsapp.net', targetMessageId: 'x' })
    navigate({ jid: 'd@s.whatsapp.net', targetMessageId: 'x' })

    expect(seen).toHaveLength(1)
  })

  it('still emits the legacy window event', () => {
    const listener = vi.fn()
    window.addEventListener('smartchat:open-chat', listener)
    navigate({ jid: 'e@s.whatsapp.net' })
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('smartchat:open-chat', listener)
  })
})
