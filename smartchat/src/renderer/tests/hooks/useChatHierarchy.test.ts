import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatHierarchy } from '@renderer/components/chat/hooks/useChatHierarchy'
import { ChatItem } from '@renderer/types/chatTypes'

describe('useChatHierarchy', () => {
  const sampleChats: ChatItem[] = [
    {
      jid: 'comm@g.us',
      name: 'Tech Community',
      isCommunity: true,
      unreadCount: 0,
      timestamp: '1000',
      lastMessage: '',
      lastMessageTimestamp: '1000',
    },
    {
      jid: 'subgroup1@g.us',
      name: 'General Chat',
      linkedParentJid: 'comm@g.us',
      unreadCount: 3,
      timestamp: '2000',
      lastMessage: '',
      lastMessageTimestamp: '2000',
    },
    {
      jid: 'standalone@s.whatsapp.net',
      name: 'Charlie',
      unreadCount: 0,
      timestamp: '1500',
      lastMessage: '',
      lastMessageTimestamp: '1500',
    },
  ]

  it('should group chats into community parents and linked children', () => {
    const { result } = renderHook(() => useChatHierarchy(sampleChats))

    expect(result.current.childrenByParent.get('comm@g.us')).toHaveLength(1)
    expect(result.current.groupedChats).toHaveLength(3) // root + child + standalone

    const rootItem = result.current.groupedChats.find((c) => c.jid === 'comm@g.us')
    expect(rootItem?.totalUnreadCount).toBe(3)
  })

  it('should toggle community expansion', () => {
    const { result } = renderHook(() => useChatHierarchy(sampleChats))

    expect(result.current.expandedCommunities.has('comm@g.us')).toBe(false)

    act(() => {
      result.current.toggleExpand('comm@g.us')
    })

    expect(result.current.expandedCommunities.has('comm@g.us')).toBe(true)

    act(() => {
      result.current.toggleExpand('comm@g.us')
    })

    expect(result.current.expandedCommunities.has('comm@g.us')).toBe(false)
  })

  it('should handle root click to select first unread child or toggle expand', () => {
    const onSelectChat = vi.fn()
    const clearUnreadCount = vi.fn()

    const { result } = renderHook(() =>
      useChatHierarchy(sampleChats, onSelectChat, clearUnreadCount)
    )

    act(() => {
      result.current.handleRootClick(sampleChats[0])
    })

    expect(onSelectChat).toHaveBeenCalledWith('subgroup1@g.us', 'General Chat', undefined)
    expect(clearUnreadCount).toHaveBeenCalledWith('subgroup1@g.us')
    expect(result.current.expandedCommunities.has('comm@g.us')).toBe(true)
  })
})
