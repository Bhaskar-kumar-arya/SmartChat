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

  it('F9-03: a push arriving before history resolves is not dropped', async () => {
    let resolveHistory: (v: any) => void = () => {}
    mockApi.extensionChatHistory = vi.fn().mockImplementation(
      () => new Promise((res) => { resolveHistory = res })
    )

    const { result } = renderHook(() => useExtensionChat('ext-1'), {
      wrapper: createWrapper(),
    })

    // Push lands while history fetch is still pending
    act(() => {
      pushCallback?.({
        extensionId: 'ext-1',
        message: { id: 'p1', role: 'extension', content: '{}', createdAt: '2' },
      })
    })

    await act(async () => {
      resolveHistory([{ id: 'h1', role: 'user', content: '{}', createdAt: '1' }])
      await Promise.resolve()
    })

    const ids = result.current.messages.map((m) => m.id)
    expect(ids).toContain('h1')
    expect(ids).toContain('p1')
  })

  it('F9-03/F9-08: a duplicate push id is not appended twice', async () => {
    mockApi.extensionChatHistory = vi.fn().mockResolvedValue([
      { id: '1', role: 'user', content: '{}', createdAt: '1' },
    ])
    const { result } = renderHook(() => useExtensionChat('ext-1'), {
      wrapper: createWrapper(),
    })
    await act(async () => { await Promise.resolve() })

    act(() => {
      pushCallback?.({ extensionId: 'ext-1', message: { id: '2', role: 'extension', content: '{}', createdAt: '2' } })
      pushCallback?.({ extensionId: 'ext-1', message: { id: '2', role: 'extension', content: '{}', createdAt: '2' } })
    })

    expect(result.current.messages.filter((m) => m.id === '2')).toHaveLength(1)
  })

  it('F9-03: a late history response for a previous extension does not overwrite', async () => {
    let resolveA: (v: any) => void = () => {}
    mockApi.extensionChatHistory = vi.fn()
      .mockImplementationOnce(() => new Promise((res) => { resolveA = res }))
      .mockImplementationOnce(() => Promise.resolve([{ id: 'b1', role: 'user', content: '{}', createdAt: '1' }]))

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useExtensionChat(id),
      { wrapper: createWrapper(), initialProps: { id: 'ext-A' } }
    )

    rerender({ id: 'ext-B' })
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      resolveA([{ id: 'a1', role: 'user', content: '{}', createdAt: '1' }])
      await Promise.resolve()
    })

    const ids = result.current.messages.map((m) => m.id)
    expect(ids).toEqual(['b1'])
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
