import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMentionSession } from '@renderer/hooks/useMentionSession'
import { ChatItem, SelectedContext } from '@renderer/types/chatTypes'

describe('useMentionSession', () => {
  const sampleChats: ChatItem[] = [
    { jid: 'user1@s.whatsapp.net', name: 'Alice Smith', unreadCount: 0, timestamp: '1000', lastMessage: '', lastMessageTimestamp: '1000' },
    { jid: 'user2@s.whatsapp.net', name: 'Bob Jones', unreadCount: 0, timestamp: '2000', lastMessage: '', lastMessageTimestamp: '2000' },
  ]

  it('should activate mention anchor on input change with @', () => {
    let inputValue = ''
    const setInputValue = vi.fn((val) => { inputValue = val })
    const setMentions = vi.fn()
    const searchContacts = vi.fn().mockResolvedValue([])
    const autoGrow = vi.fn()
    const inputRef = { current: { selectionStart: 1, focus: vi.fn(), setSelectionRange: vi.fn() } } as any

    const { result } = renderHook(() =>
      useMentionSession({
        chatList: sampleChats,
        searchContacts,
        inputValue,
        setInputValue,
        mentions: [],
        setMentions,
        inputRef,
        autoGrow,
      })
    )

    act(() => {
      result.current.onInputChange({ target: { value: '@', selectionStart: 1 } } as any)
    })

    expect(setInputValue).toHaveBeenCalledWith('@')
    expect(result.current.mentionAnchor).toBe(0)
  })

  it('should select item from dropdown and format mention token', () => {
    let inputValue = '@Alice'
    const setInputValue = vi.fn((val) => { inputValue = val })
    let mentions: SelectedContext[] = []
    const setMentions = vi.fn((fn) => {
      mentions = typeof fn === 'function' ? fn(mentions) : fn
    })
    const searchContacts = vi.fn().mockResolvedValue([])
    const autoGrow = vi.fn()
    const inputRef = { current: { selectionStart: 6, focus: vi.fn(), setSelectionRange: vi.fn() } } as any

    const { result } = renderHook(() =>
      useMentionSession({
        chatList: sampleChats,
        searchContacts,
        inputValue,
        setInputValue,
        mentions,
        setMentions,
        inputRef,
        autoGrow,
      })
    )

    act(() => {
      result.current.setMentionAnchor(0)
    })

    act(() => {
      result.current.selectItem(sampleChats[0])
    })

    expect(setInputValue).toHaveBeenCalledWith('@Alice Smith ')
    expect(mentions).toEqual([{ jid: 'user1@s.whatsapp.net', name: 'Alice Smith' }])
  })

  it('should handle chip removal', () => {
    let inputValue = '@Alice Smith Hello'
    const setInputValue = vi.fn((val) => { inputValue = val })
    let mentions: SelectedContext[] = [{ jid: 'user1@s.whatsapp.net', name: 'Alice Smith' }]
    const setMentions = vi.fn((fn) => {
      mentions = typeof fn === 'function' ? fn(mentions) : fn
    })
    const searchContacts = vi.fn().mockResolvedValue([])
    const autoGrow = vi.fn()
    const inputRef = { current: { focus: vi.fn() } } as any

    const { result } = renderHook(() =>
      useMentionSession({
        chatList: sampleChats,
        searchContacts,
        inputValue,
        setInputValue,
        mentions,
        setMentions,
        inputRef,
        autoGrow,
      })
    )

    act(() => {
      result.current.removeChip(mentions[0])
    })

    expect(setInputValue).toHaveBeenCalledWith('Hello')
    expect(mentions).toEqual([])
  })
})
