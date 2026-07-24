import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChats } from '@renderer/components/chat/hooks/useChats'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'
import { ChatItem, MessageItem } from '@renderer/types/chatTypes'

describe('useChats', () => {
  let mockApi: ReturnType<typeof createMockApiService>
  let newMessageCallback: ((msg: MessageItem) => void) | null = null

  const sampleChats: ChatItem[] = [
    { jid: 'user1@s.whatsapp.net', name: 'Alice', unreadCount: 2, timestamp: '1000', lastMessage: 'Hi', lastMessageTimestamp: '1000' },
    { jid: 'user2@s.whatsapp.net', name: 'Bob', unreadCount: 0, timestamp: '2000', lastMessage: 'Hey', lastMessageTimestamp: '2000' },
  ]

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    newMessageCallback = null
    mockApi = createMockApiService({
      getChats: vi.fn().mockResolvedValue(sampleChats),
      onNewMessage: vi.fn().mockImplementation((cb) => {
        newMessageCallback = cb
        return () => { newMessageCallback = null }
      }),
      onChatUpdated: vi.fn().mockReturnValue(() => {}),
      onMessageEdited: vi.fn().mockReturnValue(() => {}),
      onMessageStatusUpdated: vi.fn().mockReturnValue(() => {}),
    })
  })

  it('should load chat list sorted by timestamp', async () => {
    const { result } = renderHook(() => useChats(null), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApi.getChats).toHaveBeenCalledWith(1, 50)
    expect(result.current.chats).toHaveLength(2)
    expect(result.current.chats[0].jid).toBe('user1@s.whatsapp.net')
  })

  it('should filter chats by searchQuery', async () => {
    const { result } = renderHook(() => useChats(null), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      result.current.setSearchQuery('Alice')
    })

    expect(result.current.chats).toHaveLength(1)
    expect(result.current.chats[0].name).toBe('Alice')
  })

  it('should update chat last message and unread count on real-time new message', async () => {
    const { result } = renderHook(() => useChats('user2@s.whatsapp.net'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    const incoming: MessageItem = {
      id: 'm100',
      chatJid: 'user1@s.whatsapp.net',
      participant: null,
      messageType: 'conversation',
      textContent: 'New message for Alice',
      timestamp: '3000',
      fromMe: false,
    }

    act(() => {
      if (newMessageCallback) newMessageCallback(incoming)
    })

    const aliceChat = result.current.allChats.find((c) => c.jid === 'user1@s.whatsapp.net')
    expect(aliceChat?.unreadCount).toBe(3)
    expect(aliceChat?.lastMessageTimestamp).toBe('3000')
  })

  it('should clear unread count for a chat', async () => {
    const { result } = renderHook(() => useChats(null), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      result.current.clearUnreadCount('user1@s.whatsapp.net')
    })

    const aliceChat = result.current.allChats.find((c) => c.jid === 'user1@s.whatsapp.net')
    expect(aliceChat?.unreadCount).toBe(0)
  })
})
