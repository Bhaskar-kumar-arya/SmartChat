import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePresence } from '@renderer/hooks/usePresence'
import { APIProvider } from '@renderer/context/APIContext'
import { PresenceProvider } from '@renderer/context/PresenceContext'
import { createMockApiService } from '../mocks/mockApiService'
import { PresenceUpdate } from '@renderer/types/chatTypes'

describe('usePresence', () => {
  let mockApi: ReturnType<typeof createMockApiService>
  let presenceCallback: ((update: PresenceUpdate) => void) | null = null

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>
        <PresenceProvider>{children}</PresenceProvider>
      </APIProvider>
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    presenceCallback = null
    mockApi = createMockApiService({
      onPresenceUpdate: vi.fn().mockImplementation((cb) => {
        presenceCallback = cb
        return () => { presenceCallback = null }
      }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should receive real-time presence updates and calculate active status', () => {
    const { result } = renderHook(() => usePresence(), {
      wrapper: createWrapper(),
    })

    expect(result.current.getActivePresence('user1@s.whatsapp.net')).toBeNull()

    act(() => {
      if (presenceCallback) {
        presenceCallback({
          remoteJid: 'user1@s.whatsapp.net',
          presences: {
            'user1@s.whatsapp.net': {
              lastKnownPresence: 'composing',
              timestamp: Date.now(),
            },
          },
        })
      }
    })

    expect(result.current.getActivePresence('user1@s.whatsapp.net')).toBe('typing...')
  })

  it('should format group presence status for typing and recording', () => {
    const { result } = renderHook(() => usePresence(), {
      wrapper: createWrapper(),
    })

    act(() => {
      if (presenceCallback) {
        presenceCallback({
          remoteJid: 'group1@g.us',
          presences: {
            'p1@s.whatsapp.net': {
              name: 'Alice',
              lastKnownPresence: 'composing',
              timestamp: Date.now(),
            },
          },
        })
      }
    })

    expect(result.current.getActivePresence('group1@g.us')).toBe('Alice is typing...')

    act(() => {
      if (presenceCallback) {
        presenceCallback({
          remoteJid: 'group1@g.us',
          presences: {
            'p2@s.whatsapp.net': {
              name: 'Bob',
              lastKnownPresence: 'composing',
              timestamp: Date.now(),
            },
          },
        })
      }
    })

    expect(result.current.getActivePresence('group1@g.us')).toBe('2 people are typing...')
  })

  it('should expire stale typing/recording presences after interval', async () => {
    const { result } = renderHook(() => usePresence(), {
      wrapper: createWrapper(),
    })

    const pastTimestamp = Date.now() - 15000

    act(() => {
      if (presenceCallback) {
        presenceCallback({
          remoteJid: 'user1@s.whatsapp.net',
          presences: {
            'user1@s.whatsapp.net': {
              lastKnownPresence: 'composing',
              timestamp: pastTimestamp,
            },
          },
        })
      }
    })

    // Advance 2 seconds for interval check
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.getActivePresence('user1@s.whatsapp.net')).toBe('online')
  })

  it('F3-06: expires stale `available` presence after the TTL', () => {
    const { result } = renderHook(() => usePresence(), { wrapper: createWrapper() })

    act(() => {
      if (presenceCallback) {
        presenceCallback({
          remoteJid: 'user1@s.whatsapp.net',
          presences: {
            'user1@s.whatsapp.net': {
              lastKnownPresence: 'available',
              timestamp: Date.now() - 70000,
            },
          },
        })
      }
    })

    expect(result.current.getActivePresence('user1@s.whatsapp.net')).toBe('online')

    act(() => { vi.advanceTimersByTime(2000) })

    expect(result.current.getActivePresence('user1@s.whatsapp.net')).toBeNull()
  })

  it('F3-07: matches presence by JID identity, not exact string', () => {
    const { result } = renderHook(() => usePresence(), { wrapper: createWrapper() })

    act(() => {
      if (presenceCallback) {
        presenceCallback({
          remoteJid: '12345:3@s.whatsapp.net',
          presences: {
            '12345:3@s.whatsapp.net': {
              lastKnownPresence: 'composing',
              timestamp: Date.now(),
            },
          },
        })
      }
    })

    // Looked up with the device-suffix-free / @lid form.
    expect(result.current.getActivePresence('12345@lid')).toBe('typing...')
    expect(result.current.lookupPresence('12345@s.whatsapp.net')).toBeDefined()
  })
})
