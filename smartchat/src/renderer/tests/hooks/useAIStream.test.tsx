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

  it('F8-01: a stream that ends after a session switch does not write into / auto-save the new session', async () => {
    const saveCurrentMessages = vi.fn().mockResolvedValue(undefined)
    const props = {
      aiOptions: { ...defaultAiOptions, autoSaveChats: true },
      availableTools: [],
      activeSessionId: 'session-1' as string | null,
      saveCurrentMessages,
    }

    const { result, rerender } = renderHook((p) => useAIStream(p), {
      wrapper: createWrapper(),
      initialProps: props,
    })

    act(() => {
      result.current.startStream('long answer', [], 'msg-ai-1')
    })
    act(() => {
      if (onChunkCallback) onChunkCallback('partial ')
    })

    // User switches to a different session while the stream is still running.
    rerender({ ...props, activeSessionId: 'session-2' })

    vi.useFakeTimers()
    try {
      act(() => {
        if (onDoneCallback) onDoneCallback()
        vi.advanceTimersByTime(200)
      })
    } finally {
      vi.useRealTimers()
    }

    // The streamed answer must not be auto-saved against session-2.
    expect(saveCurrentMessages).not.toHaveBeenCalledWith('session-2', expect.anything())
    expect(saveCurrentMessages).not.toHaveBeenCalled()
  })

  it('F8-03: abort still clears loading/channel when abortAiChat rejects', async () => {
    mockApi.abortAiChat = vi.fn().mockRejectedValue(new Error('already gone'))
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
      result.current.startStream('hi', [], 'msg-ai-3')
    })
    await act(async () => {
      await result.current.abort()
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
