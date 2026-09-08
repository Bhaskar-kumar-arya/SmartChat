import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExtensionLog } from '@renderer/hooks/useExtensionLog'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'

describe('useExtensionLog', () => {
  let mockApi: ReturnType<typeof createMockApiService>

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockApi = createMockApiService({
      extensionGetLog: vi.fn().mockResolvedValue('Log line 1'),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return empty string when extensionId is null', () => {
    const { result } = renderHook(() => useExtensionLog(null), {
      wrapper: createWrapper(),
    })

    expect(result.current).toBe('')
    expect(mockApi.extensionGetLog).not.toHaveBeenCalled()
  })

  it('should fetch log initially and poll every 2 seconds', async () => {
    const { result } = renderHook(() => useExtensionLog('ext-1'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApi.extensionGetLog).toHaveBeenCalledWith('ext-1')
    expect(result.current).toBe('Log line 1')

    mockApi.extensionGetLog = vi.fn().mockResolvedValue('Log line 1\nLog line 2')

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    expect(result.current).toBe('Log line 1\nLog line 2')
  })

  it('F9-06: does not start an overlapping fetch while one is still pending', async () => {
    let pending = 0
    mockApi.extensionGetLog = vi.fn().mockImplementation(
      () => new Promise<string>(() => { pending++ })
    )

    renderHook(() => useExtensionLog('ext-1'), { wrapper: createWrapper() })

    await act(async () => { await Promise.resolve() })
    expect(pending).toBe(1)

    // Several intervals elapse but the first fetch never resolves
    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })
    expect(pending).toBe(1)
  })
})
