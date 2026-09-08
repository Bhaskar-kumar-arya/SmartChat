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
    // F3-08: the replace branch now also runs sortChats (Bob ts 2000 > Alice ts 1000)
    expect(result.current.chats[0].jid).toBe('user2@s.whatsapp.net')
  })

  it('F3-10: a malformed lastMessageTimestamp does not crash the list', async () => {
    const badApi = createMockApiService({
      getChats: vi.fn().mockResolvedValue([
        { jid: 'x@s.whatsapp.net', name: 'X', unreadCount: 0, timestamp: 'garbage', lastMessage: '', lastMessageTimestamp: 'not-a-ts' },
        ...sampleChats,
      ]),
      onNewMessage: vi.fn().mockReturnValue(() => {}),
      onChatUpdated: vi.fn().mockReturnValue(() => {}),
      onMessageEdited: vi.fn().mockReturnValue(() => {}),
      onMessageStatusUpdated: vi.fn().mockReturnValue(() => {}),
    })

    const { result } = renderHook(() => useChats(null), { wrapper: createWrapper(badApi) })
    await act(async () => { await Promise.resolve() })

    expect(result.current.chats).toHaveLength(3)
  })

  it('F3-04: an event arriving during the initial load is not clobbered by the fetched page', async () => {
    let resolveChats: (v: ChatItem[]) => void = () => {}
    const slowApi = createMockApiService({
      getChats: vi.fn().mockImplementation(() => new Promise((r) => { resolveChats = r })),
      getChat: vi.fn().mockResolvedValue({ jid: 'new@s.whatsapp.net', name: 'New', unreadCount: 0, timestamp: '5000', lastMessage: '', lastMessageTimestamp: '5000' }),
      onNewMessage: vi.fn().mockImplementation((cb) => { newMessageCallback = cb; return () => {} }),
      onChatUpdated: vi.fn().mockReturnValue(() => {}),
      onMessageEdited: vi.fn().mockReturnValue(() => {}),
      onMessageStatusUpdated: vi.fn().mockReturnValue(() => {}),
    })

    const { result } = renderHook(() => useChats(null), { wrapper: createWrapper(slowApi) })

    // Event lands before getChats() resolves.
    await act(async () => {
      newMessageCallback?.({
        id: 'm1', chatJid: 'new@s.whatsapp.net', participant: null,
        messageType: 'conversation', textContent: 'hi', timestamp: '5000', fromMe: false,
      } as MessageItem)
      await Promise.resolve()
    })

    await act(async () => { resolveChats(sampleChats); await Promise.resolve() })

    expect(result.current.allChats.some((c) => c.jid === 'new@s.whatsapp.net')).toBe(true)
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
