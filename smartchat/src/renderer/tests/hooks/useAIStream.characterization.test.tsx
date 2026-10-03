/**
 * N-08 characterization of useAIStream (R-UIAPP-05 safety net).
 * Pins CURRENT behaviour of executeToolCall / declineToolCall / handleRetry,
 * no-permission auto-execution, the onError path, the 30 ms drip and the 100 ms
 * auto-save timer. B-UIAPP-03 fixed in F-UA-2; remaining `it.fails` (no tool-loop turn cap -> F-AI-4).
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, type RenderHookResult } from '@testing-library/react'
import { useAIStream } from '@renderer/components/ai/hooks/useAIStream'
import { APIProvider } from '@renderer/context/APIContext'
import type { AIChatMessage, AIChatOptions, ToolDefinition } from '@renderer/types/aiTypes'
import { createMockApiService, type MockApiService } from '../mocks/mockApiService'

interface StreamCall {
  prompt: string
  context: unknown[]
  history: AIChatMessage[]
  mentions: unknown[]
  options: Record<string, unknown>
  onChunk: (c: string) => void
  onDone: () => void
  onError: (e: unknown) => void
  channel: string
}

const baseOptions: AIChatOptions = {
  useThinkMode: false,
  model: 'gpt-4o',
  contextLength: 4000,
  autoSaveChats: false,
}

const TOOL_CALL = '<tool_call>{"tool":"get_time","arguments":{"tz":"UTC"}}</tool_call>'

const tool = (name: string, requiresPermission?: boolean): ToolDefinition =>
  ({ name, description: name, parameters: {}, requiresPermission }) as unknown as ToolDefinition

const msg = (over: Partial<AIChatMessage> & { id: string; role: 'user' | 'ai' }): AIChatMessage =>
  ({ content: '', ...over }) as AIChatMessage

describe('useAIStream characterization', () => {
  let api: MockApiService
  let streams: StreamCall[]

  const last = (): StreamCall => streams[streams.length - 1]

  beforeEach(() => {
    streams = []
    api = createMockApiService({
      aiChatStream: vi.fn().mockImplementation((prompt, context, history, mentions, options, onChunk, onDone, onError) => {
        const channel = `ch-${streams.length + 1}`
        streams.push({ prompt, context, history, mentions, options, onChunk, onDone, onError, channel })
        return channel
      }),
      executeTool: vi.fn().mockResolvedValue({ ok: true }),
      abortAiChat: vi.fn().mockResolvedValue(true),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  type Props = {
    aiOptions: AIChatOptions
    availableTools: ToolDefinition[]
    activeSessionId: string | null
    saveCurrentMessages: (id: string, m: AIChatMessage[]) => Promise<void>
  }

  type Setup = RenderHookResult<ReturnType<typeof useAIStream>, Props> & { props: Props }

  const setup = (over: Partial<Props> = {}): Setup => {
    const props: Props = {
      aiOptions: baseOptions,
      availableTools: [],
      activeSessionId: 'session-1',
      saveCurrentMessages: vi.fn().mockResolvedValue(undefined),
      ...over,
    }
    const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
      <APIProvider service={api}>{children}</APIProvider>
    )
    const hook = renderHook((p: Props) => useAIStream(p), { wrapper, initialProps: props })
    return { ...hook, props }
  }

  /** Seed messages in both state and the ref (the ref is what the handlers read). */
  const seed = (
    result: { current: ReturnType<typeof useAIStream> },
    msgs: AIChatMessage[]
  ): void => {
    act(() => {
      result.current.setMessages(msgs)
      result.current.messagesRef.current = msgs
    })
  }

  describe('startStream', () => {
    it('passes prompt/context/history/mentions and merges isSystem into the AI options', () => {
      const { result } = setup({ aiOptions: { ...baseOptions, model: 'm-x' } })
      const history = [msg({ id: 'h1', role: 'user', content: 'earlier' })]
      act(() => {
        result.current.startStream('hello', history, 'ai-1', [], [], true)
      })
      expect(last().prompt).toBe('hello')
      expect(last().history).toBe(history)
      expect(last().options).toMatchObject({ model: 'm-x', isSystem: true })
      expect(result.current.loading).toBe(true)
      expect(result.current.activeChannelId).toBe('ch-1')
    })

    it('whitespace-only chunks do not clear loading; the first real chunk does', () => {
      const { result } = setup()
      act(() => {
        result.current.startStream('p', [], 'ai-1')
      })
      act(() => last().onChunk('   \n'))
      expect(result.current.loading).toBe(true)
      act(() => last().onChunk('hi'))
      expect(result.current.loading).toBe(false)
    })

    it('drips buffered text into the AI message every 30 ms (max(2, ceil(len/8)) chars per tick)', () => {
      vi.useFakeTimers()
      const { result } = setup()
      seed(result, [msg({ id: 'ai-1', role: 'ai', content: '' })])
      act(() => {
        result.current.startStream('p', [], 'ai-1')
      })
      act(() => last().onChunk('abcdefghijklmnop')) // 16 chars -> 2 per tick
      expect(result.current.messages[0].content).toBe('')
      act(() => {
        vi.advanceTimersByTime(30)
      })
      expect(result.current.messages[0].content).toBe('ab')
      act(() => {
        vi.advanceTimersByTime(30)
      })
      // remaining 14 chars -> ceil(14/8) = 2
      expect(result.current.messages[0].content).toBe('abcd')
    })

    it('onDone flushes the undripped remainder, clears loading/channel', () => {
      vi.useFakeTimers()
      const { result } = setup()
      seed(result, [msg({ id: 'ai-1', role: 'ai', content: '' })])
      act(() => {
        result.current.startStream('p', [], 'ai-1')
      })
      act(() => last().onChunk('full answer'))
      act(() => last().onDone())
      expect(result.current.messages[0].content).toBe('full answer')
      expect(result.current.messagesRef.current[0].content).toBe('full answer')
      expect(result.current.loading).toBe(false)
      expect(result.current.activeChannelId).toBeNull()
    })
  })

  describe('onError', () => {
    it('appends the error to the AI message and flags hasError', () => {
      const { result } = setup()
      seed(result, [msg({ id: 'ai-1', role: 'ai', content: 'partial' })])
      act(() => {
        result.current.startStream('p', [], 'ai-1')
      })
      act(() => last().onError('quota exceeded'))
      expect(result.current.messages[0].content).toBe('partial\n\n**Error:** quota exceeded')
      expect(result.current.messages[0].hasError).toBe(true)
      expect(result.current.loading).toBe(false)
      expect(result.current.activeChannelId).toBeNull()
    })

    it('stringifies Error objects', () => {
      const { result } = setup()
      seed(result, [msg({ id: 'ai-1', role: 'ai', content: '' })])
      act(() => {
        result.current.startStream('p', [], 'ai-1')
      })
      act(() => last().onError(new Error('boom')))
      expect(result.current.messages[0].content).toContain('**Error:** Error: boom')
    })

    it('does not write the error into a different session after a switch (F8-01)', () => {
      const { result, rerender, props } = setup()
      seed(result, [msg({ id: 'ai-1', role: 'ai', content: 'x' })])
      act(() => {
        result.current.startStream('p', [], 'ai-1')
      })
      rerender({ ...props, activeSessionId: 'session-2' })
      act(() => last().onError('late'))
      expect(result.current.messages[0].content).toBe('x')
      expect(result.current.loading).toBe(false)
    })
  })

  describe('auto-execution and auto-save (100 ms timer after onDone)', () => {
    const finish = (result: { current: ReturnType<typeof useAIStream> }, content: string): void => {
      seed(result, [msg({ id: 'ai-1', role: 'ai', content: '' })])
      act(() => {
        result.current.startStream('p', [], 'ai-1')
      })
      act(() => last().onChunk(content))
      act(() => last().onDone())
    }

    it('auto-executes a tool call whose tool has requiresPermission === false', async () => {
      vi.useFakeTimers()
      const { result } = setup({ availableTools: [tool('get_time', false)] })
      finish(result, TOOL_CALL)
      expect(api.executeTool).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(api.executeTool).toHaveBeenCalledTimes(1)
      expect(api.executeTool).toHaveBeenCalledWith('get_time', { tz: 'UTC' }, 'session-1')
    })

    it.each([
      ['requiresPermission true', tool('get_time', true)],
      ['requiresPermission undefined', tool('get_time', undefined)],
      ['a different tool name', tool('other', false)],
    ])('does not auto-execute when %s', async (_label, t) => {
      vi.useFakeTimers()
      const { result } = setup({ availableTools: [t] })
      finish(result, TOOL_CALL)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(api.executeTool).not.toHaveBeenCalled()
    })

    it('does not run the same message twice (F8-13 guard) even if onDone fires again', async () => {
      vi.useFakeTimers()
      let release: (v: unknown) => void = () => {}
      api.executeTool = vi.fn().mockImplementation(() => new Promise((r) => { release = r }))
      const { result } = setup({ availableTools: [tool('get_time', false)] })
      finish(result, TOOL_CALL)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      act(() => last().onDone())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(api.executeTool).toHaveBeenCalledTimes(1)
      release({})
    })

    it('does not auto-execute when the user already resolved the card (toolResult present)', async () => {
      vi.useFakeTimers()
      const { result } = setup({ availableTools: [tool('get_time', false)] })
      finish(result, TOOL_CALL)
      act(() => {
        result.current.messagesRef.current = result.current.messagesRef.current.map((m) =>
          m.id === 'ai-1' ? { ...m, toolResult: 'declined' } : m
        )
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(api.executeTool).not.toHaveBeenCalled()
    })

    it('a malformed tool call neither executes nor auto-saves', async () => {
      vi.useFakeTimers()
      const save = vi.fn().mockResolvedValue(undefined)
      const { result } = setup({
        aiOptions: { ...baseOptions, autoSaveChats: true },
        availableTools: [tool('get_time', false)],
        saveCurrentMessages: save,
      })
      finish(result, '<tool_call>{not json</tool_call>')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(api.executeTool).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
    })

    it('auto-saves the finished conversation after 100 ms when enabled and there is no tool call', async () => {
      vi.useFakeTimers()
      const save = vi.fn().mockResolvedValue(undefined)
      const { result } = setup({ aiOptions: { ...baseOptions, autoSaveChats: true }, saveCurrentMessages: save })
      finish(result, 'plain answer')
      expect(save).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(save).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledWith('session-1', [
        expect.objectContaining({ id: 'ai-1', content: 'plain answer' }),
      ])
    })

    it('does not auto-save when disabled or when there is no active session', async () => {
      vi.useFakeTimers()
      const save = vi.fn().mockResolvedValue(undefined)
      const a = setup({ saveCurrentMessages: save })
      finish(a.result, 'answer')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      const b = setup({ aiOptions: { ...baseOptions, autoSaveChats: true }, activeSessionId: null, saveCurrentMessages: save })
      finish(b.result, 'answer')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(save).not.toHaveBeenCalled()
    })
  })

  describe('executeToolCall', () => {
    const seedCall = (result: { current: ReturnType<typeof useAIStream> }): AIChatMessage[] => {
      const msgs = [
        msg({ id: 'u1', role: 'user', content: 'what time?' }),
        msg({ id: 'ai-1', role: 'ai', content: TOOL_CALL }),
      ]
      seed(result, msgs)
      return msgs
    }

    it('runs the tool, stores the JSON result on the card, appends hidden system + empty AI messages, and restarts a system stream', async () => {
      api.executeTool = vi.fn().mockResolvedValue({ now: '12:00' })
      const { result } = setup()
      seedCall(result)
      await act(async () => {
        await result.current.executeToolCall('ai-1', 'get_time', { tz: 'UTC' })
      })
      const payload = JSON.stringify({ now: '12:00' }, null, 2)
      expect(api.executeTool).toHaveBeenCalledWith('get_time', { tz: 'UTC' }, 'session-1')

      const msgs = result.current.messages
      expect(msgs).toHaveLength(4)
      expect(msgs[1].toolResult).toBe(payload)
      expect(msgs[2]).toMatchObject({
        role: 'user',
        isHidden: true,
        isSystem: true,
        content: `Tool Execution Result:\n\`\`\`json\n${payload}\n\`\`\`\n\n`,
      })
      expect(msgs[3]).toMatchObject({ role: 'ai', content: '', isSystem: false })
      expect(result.current.messagesRef.current).toEqual(msgs)
      expect(result.current.executingToolId).toBeNull()

      expect(streams).toHaveLength(1)
      expect(last().prompt).toBe(`[SYSTEM] Tool Result:\n\`\`\`json\n${payload}\n\`\`\`\n\nThe tool has completed.`)
      expect(last().options.isSystem).toBe(true)
      // history = messages up to and including the resolved card, excluding the new pair
      expect(last().history.map((m) => m.id)).toEqual(['u1', 'ai-1'])
      expect(last().history[1].toolResult).toBe(payload)
      expect(result.current.loading).toBe(true)
    })

    it('exposes executingToolId while the tool runs', async () => {
      let release: (v: unknown) => void = () => {}
      api.executeTool = vi.fn().mockImplementation(() => new Promise((r) => { release = r }))
      const { result } = setup()
      seedCall(result)
      let p: Promise<void> | undefined
      act(() => {
        p = result.current.executeToolCall('ai-1', 'get_time', {})
      })
      expect(result.current.executingToolId).toBe('ai-1')
      await act(async () => {
        release({})
        await p
      })
      expect(result.current.executingToolId).toBeNull()
    })

    it('a throwing tool is reported to the model as {error} and the loop continues', async () => {
      api.executeTool = vi.fn().mockRejectedValue(new Error('denied'))
      const { result } = setup()
      seedCall(result)
      await act(async () => {
        await result.current.executeToolCall('ai-1', 'get_time', {})
      })
      expect(result.current.messages[1].toolResult).toBe(JSON.stringify({ error: 'denied' }))
      expect(streams).toHaveLength(1)
    })

    it('stringifies non-Error rejections', async () => {
      api.executeTool = vi.fn().mockRejectedValue('plain string')
      const { result } = setup()
      seedCall(result)
      await act(async () => {
        await result.current.executeToolCall('ai-1', 'get_time', {})
      })
      expect(result.current.messages[1].toolResult).toBe(JSON.stringify({ error: 'plain string' }))
    })

    // B-UIAPP-03: continues into whichever session is current after `await api.executeTool`.
    it('B-UIAPP-03: a tool result arriving after a session switch does not start a stream in the new session', async () => {
      let release: (v: unknown) => void = () => {}
      api.executeTool = vi.fn().mockImplementation(() => new Promise((r) => { release = r }))
      const { result, rerender, props } = setup()
      seedCall(result)
      let p: Promise<void> | undefined
      act(() => {
        p = result.current.executeToolCall('ai-1', 'get_time', {})
      })
      rerender({ ...props, activeSessionId: 'session-2' })
      await act(async () => {
        release({ late: true })
        await p
      })
      expect(streams).toHaveLength(0)
      // nothing written into the new session's messages, spinner cleared
      expect(result.current.messages.map((m) => m.id)).toEqual(['u1', 'ai-1'])
      expect(result.current.messages[1].toolResult).toBeUndefined()
      expect(result.current.executingToolId).toBeNull()
    })

    // No turn cap in the live renderer loop (AI audit; F-AI-4). Main-process loop caps at 25.
    it.fails('F-AI-4: the renderer tool loop stops after a bounded number of consecutive tool turns', async () => {
      vi.useFakeTimers()
      const { result } = setup({ availableTools: [tool('get_time', false)] })
      seed(result, [msg({ id: 'ai-0', role: 'ai', content: '' })])
      act(() => {
        result.current.startStream('p', [], 'ai-0')
      })
      for (let turn = 0; turn < 30; turn++) {
        const before = streams.length
        act(() => last().onChunk(TOOL_CALL))
        act(() => last().onDone())
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100)
        })
        if (streams.length === before) break // loop stopped
      }
      expect((api.executeTool as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(25)
    })
  })

  describe('declineToolCall', () => {
    it('records the decline, appends hidden system + empty AI messages and restarts a system stream without running the tool', async () => {
      const { result } = setup()
      seed(result, [
        msg({ id: 'u1', role: 'user', content: 'do it' }),
        msg({ id: 'ai-1', role: 'ai', content: TOOL_CALL }),
      ])
      await act(async () => {
        await result.current.declineToolCall('ai-1')
      })
      expect(api.executeTool).not.toHaveBeenCalled()
      const msgs = result.current.messages
      expect(msgs).toHaveLength(4)
      expect(msgs[1].toolResult).toBe('User declined tool execution.')
      expect(msgs[2]).toMatchObject({
        role: 'user',
        isHidden: true,
        isSystem: true,
        content:
          '[SYSTEM] Tool Execution Result: User declined tool execution.\n\nThe user declined this tool execution. Acknowledge and ask how to proceed.',
      })
      expect(msgs[3]).toMatchObject({ role: 'ai', content: '', isSystem: false })
      expect(last().prompt).toMatch(/^Tool declined: User declined tool execution\./)
      expect(last().options.isSystem).toBe(true)
      expect(last().history.map((m) => m.id)).toEqual(['u1', 'ai-1'])
    })
  })

  describe('handleRetry', () => {
    const conversation = (): AIChatMessage[] => [
      msg({ id: 'u0', role: 'user', content: 'first' }),
      msg({ id: 'a0', role: 'ai', content: 'first answer' }),
      msg({ id: 'u1', role: 'user', content: 'second', mentions: [{ id: 'c1' }] as unknown as AIChatMessage['mentions'] }),
      msg({ id: 'a1', role: 'ai', content: 'bad', hasError: true }),
    ]

    it('clears the AI message, and restreams from the preceding user message with the older history', () => {
      const { result } = setup()
      seed(result, conversation())
      act(() => {
        result.current.handleRetry('a1')
      })
      expect(result.current.messages[3]).toMatchObject({ id: 'a1', content: '', hasError: false })
      expect(result.current.messagesRef.current[3].content).toBe('')
      expect(last().prompt).toBe('second')
      expect(last().history.map((m) => m.id)).toEqual(['u0', 'a0'])
      expect(last().mentions).toEqual([{ id: 'c1' }])
      expect(last().options.isSystem).toBeFalsy()
      expect(result.current.loading).toBe(true)
    })

    it('forwards isSystem from a hidden system trigger message', () => {
      const { result } = setup()
      seed(result, [
        msg({ id: 'u0', role: 'user', content: 'sys', isSystem: true }),
        msg({ id: 'a0', role: 'ai', content: 'x' }),
      ])
      act(() => {
        result.current.handleRetry('a0')
      })
      expect(last().options.isSystem).toBe(true)
    })

    it.each([
      ['unknown id', 'nope'],
      ['first message (index 0)', 'u0'],
      ['a user message', 'u1'],
    ])('is a no-op for %s', (_l, id) => {
      const { result } = setup()
      seed(result, conversation())
      act(() => {
        result.current.handleRetry(id)
      })
      expect(streams).toHaveLength(0)
      expect(result.current.messages[3].content).toBe('bad')
    })
  })

  describe('abort / unmount', () => {
    it('aborts the in-flight channel on unmount (F8-01/02)', () => {
      const { result, unmount } = setup()
      act(() => {
        result.current.startStream('p', [], 'ai-1')
      })
      unmount()
      expect(api.abortAiChat).toHaveBeenCalledWith('ch-1')
    })

    it('does not abort on unmount when nothing is streaming', () => {
      const { unmount } = setup()
      unmount()
      expect(api.abortAiChat).not.toHaveBeenCalled()
    })
  })
})
