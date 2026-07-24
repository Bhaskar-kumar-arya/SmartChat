import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearch } from '@renderer/components/chat/hooks/useSearch'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'

describe('useSearch', () => {
  let mockApi: ReturnType<typeof createMockApiService>

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockApi = createMockApiService({
      searchAll: vi.fn().mockResolvedValue({
        chats: [{ jid: 'user1@s.whatsapp.net', name: 'Alice' }],
        messages: [{ id: 'm1', chatJid: 'user1@s.whatsapp.net', textContent: 'Hello Alice' }],
      }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return empty results when query is empty', () => {
    const { result } = renderHook(() => useSearch(''), {
      wrapper: createWrapper(),
    })

    expect(result.current.results).toEqual({ chats: [], messages: [] })
    expect(result.current.isSearching).toBe(false)
    expect(mockApi.searchAll).not.toHaveBeenCalled()
  })

  it('should debounce and perform search', async () => {
    const { result } = renderHook(() => useSearch('Alice', 'normal'), {
      wrapper: createWrapper(),
    })

    expect(result.current.isSearching).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(mockApi.searchAll).toHaveBeenCalledWith('Alice', 'normal', undefined)
    expect(result.current.results.chats).toHaveLength(1)
    expect(result.current.isSearching).toBe(false)
  })

  it('should use deep debounce (600ms) for deep search mode', async () => {
    renderHook(() => useSearch('project query', 'deep'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(mockApi.searchAll).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(mockApi.searchAll).toHaveBeenCalledWith('project query', 'deep', undefined)
  })
})
