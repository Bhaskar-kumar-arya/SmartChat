import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderWithProviders, screen } from './testUtils'
import { useAPI } from '@renderer/context/APIContext'
import { createMockApiService } from './mocks/mockApiService'
import { makeChat, makeMessage } from './factories'

function TestComponent() {
  const api = useAPI()
  const [jid, setJid] = React.useState<string | null>(null)

  React.useEffect(() => {
    api.getMyJid().then(setJid)
  }, [api])

  return <div data-testid="jid-container">{jid || 'Loading...'}</div>
}

describe('Renderer Test Environment Setup', () => {
  it('renders components with APIProvider and default mockApiService', async () => {
    renderWithProviders(<TestComponent />)

    expect(screen.getByTestId('jid-container')).toHaveTextContent('Loading...')
    expect(await screen.findByTestId('jid-container')).toHaveTextContent('me@s.whatsapp.net')
  })

  it('allows overriding mockApiService methods per test', async () => {
    const customApiService = {
      getMyJid: vi.fn().mockResolvedValue('custom@s.whatsapp.net'),
    }

    renderWithProviders(<TestComponent />, {
      apiService: createMockApiService(customApiService),
    })

    expect(await screen.findByTestId('jid-container')).toHaveTextContent('custom@s.whatsapp.net')
  })
})

describe('mock api emit helpers', () => {
  it('delivers typed events to subscribers and stops after unsubscribe', () => {
    const api = createMockApiService()
    const received: string[] = []
    const off = api.onNewMessage((m) => received.push(m.id))
    expect(api.emit.listenerCount('onNewMessage')).toBe(1)

    api.emit.newMessage(makeMessage({ id: 'a' }))
    off()
    api.emit.newMessage(makeMessage({ id: 'b' }))

    expect(received).toEqual(['a'])
    expect(api.emit.listenerCount('onNewMessage')).toBe(0)
  })

  it('emit.event is equivalent to the named helper and supports multiple listeners', () => {
    const api = createMockApiService()
    const a = vi.fn()
    const b = vi.fn()
    api.onWaSyncProgress(a)
    api.onWaSyncProgress(b)

    api.emit.event('onWaSyncProgress', { progress: 5, syncType: 1, syncFullHistory: false })

    expect(a).toHaveBeenCalledWith({ progress: 5, syncType: 1, syncFullHistory: false })
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('keeps registries independent per service instance', () => {
    const one = createMockApiService()
    const two = createMockApiService()
    const cb = vi.fn()
    one.onWaQr(cb)
    two.emit.waQr('qr')
    expect(cb).not.toHaveBeenCalled()
    one.emit.waQr('qr')
    expect(cb).toHaveBeenCalledWith('qr')
  })
})

describe('factories', () => {
  it('produce unique ids and honour overrides', () => {
    const m1 = makeMessage()
    const m2 = makeMessage({ textContent: 'x' })
    expect(m1.id).not.toBe(m2.id)
    expect(m2.textContent).toBe('x')
    expect(makeChat().jid).not.toBe(makeChat().jid)
  })
})

describe('global afterEach resets', () => {
  it('leaves a pending navigation intent behind (arrange)', async () => {
    const { navigate } = await import('../src/utils/navigationBus')
    navigate({ jid: 'leak@s.whatsapp.net' })
  })

  it('does not replay the previous test pending navigation intent', async () => {
    const { subscribeNavigation } = await import('../src/utils/navigationBus')
    const listener = vi.fn()
    subscribeNavigation(listener)
    expect(listener).not.toHaveBeenCalled()
  })
})
