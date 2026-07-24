import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAIChatSessions } from '@renderer/components/ai/hooks/useAIChatSessions'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'
import { AIChatSessionItem } from '@renderer/types/aiTypes'

describe('useAIChatSessions', () => {
  let mockApi: ReturnType<typeof createMockApiService>

  const sampleSessions: AIChatSessionItem[] = [
    {
      id: 'sess-1',
      title: 'First Chat Session',
      createdAt: '1000',
      updatedAt: '1000',
    },
  ]

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    mockApi = createMockApiService({
      listAiSessions: vi.fn().mockResolvedValue(sampleSessions),
      createAiSession: vi.fn().mockImplementation((title, modelId) =>
        Promise.resolve({ id: 'sess-2', title, modelId, createdAt: '2000', updatedAt: '2000' })
      ),
      getAiSession: vi.fn().mockResolvedValue({
        id: 'sess-1',
        title: 'First Chat Session',
        messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      }),
      saveAiSessionMessages: vi.fn().mockResolvedValue(undefined),
      renameAiSession: vi.fn().mockResolvedValue(undefined),
      deleteAiSession: vi.fn().mockResolvedValue(undefined),
      cloneAiSession: vi.fn().mockResolvedValue({ id: 'sess-3', title: 'Copy of First Chat Session' }),
    })
  })

  it('should list sessions on mount', async () => {
    const { result } = renderHook(() => useAIChatSessions(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApi.listAiSessions).toHaveBeenCalledWith(1, 50)
    expect(result.current.sessions).toEqual(sampleSessions)
  })

  it('should create new AI session and set active session ID', async () => {
    const { result } = renderHook(() => useAIChatSessions(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    let createdId: string | null = null
    await act(async () => {
      createdId = await result.current.createSession('Hello AI Bot', 'gpt-4o')
    })

    expect(createdId).toBe('sess-2')
    expect(result.current.activeSessionId).toBe('sess-2')
    expect(mockApi.createAiSession).toHaveBeenCalledWith('Hello AI Bot', 'gpt-4o')
  })

  it('should select an existing session and load messages', async () => {
    const { result } = renderHook(() => useAIChatSessions(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    let msgs: any[] = []
    await act(async () => {
      msgs = await result.current.selectSession('sess-1')
    })

    expect(mockApi.getAiSession).toHaveBeenCalledWith('sess-1')
    expect(result.current.activeSessionId).toBe('sess-1')
    expect(msgs).toHaveLength(1)
  })

  it('should handle session rename, delete, clone, and start new chat', async () => {
    const { result } = renderHook(() => useAIChatSessions(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.renameSession('sess-1', 'Renamed Title')
    })
    expect(mockApi.renameAiSession).toHaveBeenCalledWith('sess-1', 'Renamed Title')

    await act(async () => {
      await result.current.cloneSession('sess-1')
    })
    expect(mockApi.cloneAiSession).toHaveBeenCalledWith('sess-1')

    await act(async () => {
      await result.current.deleteSession('sess-1')
    })
    expect(mockApi.deleteAiSession).toHaveBeenCalledWith('sess-1')

    act(() => {
      result.current.startNewChat()
    })
    expect(result.current.activeSessionId).toBeNull()
  })
})
