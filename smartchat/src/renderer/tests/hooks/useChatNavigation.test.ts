import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatNavigation } from '@renderer/hooks/useChatNavigation'

describe('useChatNavigation', () => {
  it('should dispatch smartchat:open-chat event on navigateToChat', async () => {
    const listener = vi.fn()
    window.addEventListener('smartchat:open-chat', listener)

    const { result } = renderHook(() => useChatNavigation())

    await act(async () => {
      await result.current.navigateToChat('user@s.whatsapp.net')
    })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({ jid: 'user@s.whatsapp.net' })

    window.removeEventListener('smartchat:open-chat', listener)
  })

  it('should dispatch smartchat:open-chat event with targetMessageId on navigateToMessage', async () => {
    const listener = vi.fn()
    window.addEventListener('smartchat:open-chat', listener)

    const { result } = renderHook(() => useChatNavigation())

    await act(async () => {
      await result.current.navigateToMessage('group@g.us', 'msg-123')
    })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({ jid: 'group@g.us', targetMessageId: 'msg-123' })

    window.removeEventListener('smartchat:open-chat', listener)
  })
})
