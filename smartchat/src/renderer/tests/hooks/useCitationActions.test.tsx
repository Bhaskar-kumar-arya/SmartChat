import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCitationActions } from '@renderer/hooks/useCitationActions'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'

describe('useCitationActions', () => {
  let mockApi: ReturnType<typeof createMockApiService>

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    mockApi = createMockApiService()
  })

  it('should dispatch message citation by opening chat with target message', async () => {
    const listener = vi.fn()
    window.addEventListener('smartchat:open-chat', listener)

    const { result } = renderHook(() => useCitationActions(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.dispatch({
        type: 'message',
        chatJid: 'user@s.whatsapp.net',
        messageId: 'msg-456',
      })
    })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({ jid: 'user@s.whatsapp.net', targetMessageId: 'msg-456' })

    window.removeEventListener('smartchat:open-chat', listener)
  })

  it('should dispatch file citation by calling api.openFile', async () => {
    const { result } = renderHook(() => useCitationActions(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.dispatch({
        type: 'file',
        filePath: '/tmp/report.pdf',
      })
    })

    expect(mockApi.openFile).toHaveBeenCalledWith('/tmp/report.pdf')
  })
})
