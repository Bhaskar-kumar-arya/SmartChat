import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCitation } from '@renderer/hooks/useCitation'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'
import { CitationEntity } from '@renderer/types/ai/citation.types'

describe('useCitation', () => {
  let mockApi: ReturnType<typeof createMockApiService>

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    mockApi = createMockApiService()
  })

  it('should return null when sessionId is null', async () => {
    const { result } = renderHook(() => useCitation({ sessionId: null }), {
      wrapper: createWrapper(),
    })

    let resolvedEntity: CitationEntity | null = null
    await act(async () => {
      resolvedEntity = await result.current.resolve(1)
    })

    expect(resolvedEntity).toBeNull()
    expect(mockApi.resolveCitation).not.toHaveBeenCalled()
  })

  it('should resolve citation via API and update loading state', async () => {
    const mockEntity: CitationEntity = {
      type: 'chat',
      chatJid: 'user@s.whatsapp.net',
    }
    mockApi.resolveCitation = vi.fn().mockResolvedValue(mockEntity)

    const { result } = renderHook(() => useCitation({ sessionId: 'session-1' }), {
      wrapper: createWrapper(),
    })

    let resolvedEntity: CitationEntity | null = null
    await act(async () => {
      resolvedEntity = await result.current.resolve(1)
    })

    expect(resolvedEntity).toEqual(mockEntity)
    expect(mockApi.resolveCitation).toHaveBeenCalledWith('session-1', 1)
  })

  it('should memoize citations and avoid repeated IPC calls', async () => {
    const mockEntity: CitationEntity = {
      type: 'file',
      filePath: '/path/to/doc.pdf',
    }
    mockApi.resolveCitation = vi.fn().mockResolvedValue(mockEntity)

    const { result } = renderHook(() => useCitation({ sessionId: 'session-memo' }), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.resolve(5)
      await result.current.resolve(5)
    })

    expect(mockApi.resolveCitation).toHaveBeenCalledTimes(1)
  })
})
