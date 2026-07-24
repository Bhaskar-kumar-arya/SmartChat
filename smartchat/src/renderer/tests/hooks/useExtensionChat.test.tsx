import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExtensionChat } from '@renderer/hooks/useExtensionChat'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'

describe('useExtensionChat', () => {
  let mockApi: ReturnType<typeof createMockApiService>
  let pushCallback: ((payload: any) => void) | null = null

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    pushCallback = null
    mockApi = createMockApiService({
      extensionChatHistory: vi.fn().mockResolvedValue([
        { id: '1', role: 'user', text: 'hello', timestamp: 100 },
      ]),
      onExtensionChatPush: vi.fn().mockImplementation((cb) => {
        pushCallback = cb
        return () => { pushCallback = null }
      }),
      extensionChatSend: vi.fn(),
    })
  })

  it('should load history and subscribe to push messages', async () => {
    const { result } = renderHook(() => useExtensionChat('ext-1'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApi.extensionChatHistory).toHaveBeenCalledWith('ext-1')
    expect(result.current.messages).toHaveLength(1)

    // Simulate push message
    act(() => {
      if (pushCallback) {
        pushCallback({
          extensionId: 'ext-1',
          message: { id: '2', role: 'assistant', text: 'response', timestamp: 200 },
        })
      }
    })

    expect(result.current.messages).toHaveLength(2)
  })

  it('should send extension chat message', () => {
    const { result } = renderHook(() => useExtensionChat('ext-1'), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.send('test message')
    })

    expect(mockApi.extensionChatSend).toHaveBeenCalledWith('ext-1', 'test message')
  })
})
