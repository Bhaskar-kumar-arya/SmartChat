import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessages } from '@renderer/components/chat/hooks/useMessages'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'
import { MessageItem } from '@renderer/types/chatTypes'

describe('useMessages', () => {
  let mockApi: ReturnType<typeof createMockApiService>
  let newMessageCallback: ((msg: MessageItem) => void) | null = null

  const sampleMessages: MessageItem[] = [
    {
      id: 'msg-1',
      chatJid: 'user@s.whatsapp.net',
      fromMe: false,
      participant: 'user@s.whatsapp.net',
      messageType: 'conversation',
      textContent: 'Hello world',
      timestamp: '1000',
      status: 'SENT',
    },
  ]

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    newMessageCallback = null

    mockApi = createMockApiService({
      getMessages: vi.fn().mockResolvedValue(sampleMessages),
      getMessagesAround: vi.fn().mockResolvedValue(sampleMessages),
      markRead: vi.fn().mockResolvedValue(true),
      onNewMessage: vi.fn().mockImplementation((cb) => {
        newMessageCallback = cb
        return () => { newMessageCallback = null }
      }),
      onMessageEdited: vi.fn().mockReturnValue(() => {}),
      onMessageDeleted: vi.fn().mockReturnValue(() => {}),
      onMessageStatusUpdated: vi.fn().mockReturnValue(() => {}),
    })
  })

  it('should load initial messages when activeJid is provided', async () => {
    const { result } = renderHook(() => useMessages('user@s.whatsapp.net'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApi.getMessages).toHaveBeenCalledWith('user@s.whatsapp.net', 1, 50)
    expect(mockApi.markRead).toHaveBeenCalledWith('user@s.whatsapp.net')
    expect(result.current.messages).toEqual(sampleMessages)
  })

  it('should perform jump to target message if initialTargetId is specified', async () => {
    renderHook(() => useMessages('user@s.whatsapp.net', 'msg-999'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApi.getMessagesAround).toHaveBeenCalledWith('user@s.whatsapp.net', 'msg-999')
  })

  it('should receive real-time new messages for active chat', async () => {
    const { result } = renderHook(() => useMessages('user@s.whatsapp.net'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    const incoming: MessageItem = {
      id: 'msg-2',
      chatJid: 'user@s.whatsapp.net',
      fromMe: true,
      participant: null,
      messageType: 'conversation',
      textContent: 'Second message',
      timestamp: '2000',
      status: 'SENT',
    }

    act(() => {
      if (newMessageCallback) newMessageCallback(incoming)
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1].id).toBe('msg-2')
  })

  it('should send message via API and append to message list', async () => {
    const { result } = renderHook(() => useMessages('user@s.whatsapp.net'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.sendMessage('New outgoing msg')
    })

    expect(mockApi.sendMessage).toHaveBeenCalledWith('user@s.whatsapp.net', 'New outgoing msg', undefined, undefined)
    expect(result.current.messages).toHaveLength(2)
  })

  it('should edit message and update in state', async () => {
    const { result } = renderHook(() => useMessages('user@s.whatsapp.net'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.editMessage('msg-1', 'Edited content')
    })

    expect(mockApi.editMessage).toHaveBeenCalledWith('user@s.whatsapp.net', 'msg-1', 'Edited content')
    expect(result.current.messages[0].textContent).toBe('Edited content')
  })

  it('should delete message and mark as deleted in state', async () => {
    const { result } = renderHook(() => useMessages('user@s.whatsapp.net'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.deleteMessage('msg-1')
    })

    expect(mockApi.deleteMessage).toHaveBeenCalledWith('user@s.whatsapp.net', 'msg-1')
    expect(result.current.messages[0].isDeleted).toBe(true)
  })
})
