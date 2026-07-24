import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAIStream } from '@renderer/components/ai/hooks/useAIStream'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'
import { AIChatOptions } from '@renderer/types/aiTypes'

describe('useAIStream', () => {
  let mockApi: ReturnType<typeof createMockApiService>
  let onChunkCallback: ((chunk: string) => void) | null = null
  let onDoneCallback: (() => void) | null = null

  const defaultAiOptions: AIChatOptions = {
    useThinkMode: false,
    model: 'gpt-4o',
    contextLength: 4000,
    autoSaveChats: false,
  }

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    onChunkCallback = null
    onDoneCallback = null

    mockApi = createMockApiService({
      aiChatStream: vi.fn().mockImplementation((_p, _c, _h, _m, _opt, onChunk, onDone) => {
        onChunkCallback = onChunk
        onDoneCallback = onDone
        return 'channel-mock'
      }),
      abortAiChat: vi.fn().mockResolvedValue(true),
      executeTool: vi.fn().mockResolvedValue({ success: true }),
    })
  })

  it('should initialize with empty messages state', () => {
    const { result } = renderHook(
      () =>
        useAIStream({
          aiOptions: defaultAiOptions,
          availableTools: [],
          activeSessionId: null,
          saveCurrentMessages: vi.fn(),
        }),
      { wrapper: createWrapper() }
    )

    expect(result.current.messages).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.activeChannelId).toBeNull()
  })

  it('should start streaming response from AI stream IPC', async () => {
    const { result } = renderHook(
      () =>
        useAIStream({
          aiOptions: defaultAiOptions,
          availableTools: [],
          activeSessionId: 'session-1',
          saveCurrentMessages: vi.fn(),
        }),
      { wrapper: createWrapper() }
    )

    act(() => {
      result.current.startStream('What is AI?', [], 'msg-ai-1')
    })

    expect(result.current.loading).toBe(true)
    expect(result.current.activeChannelId).toBe('channel-mock')

    act(() => {
      if (onChunkCallback) onChunkCallback('AI stands for Artificial Intelligence.')
    })

    act(() => {
      if (onDoneCallback) onDoneCallback()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.activeChannelId).toBeNull()
  })

  it('should handle abort request', async () => {
    const { result } = renderHook(
      () =>
        useAIStream({
          aiOptions: defaultAiOptions,
          availableTools: [],
          activeSessionId: 'session-1',
          saveCurrentMessages: vi.fn(),
        }),
      { wrapper: createWrapper() }
    )

    act(() => {
      result.current.startStream('Explain quantum mechanics', [], 'msg-ai-2')
    })

    await act(async () => {
      await result.current.abort()
    })

    expect(mockApi.abortAiChat).toHaveBeenCalledWith('channel-mock')
    expect(result.current.loading).toBe(false)
    expect(result.current.activeChannelId).toBeNull()
  })
})
