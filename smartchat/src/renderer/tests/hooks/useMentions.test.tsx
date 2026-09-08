import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMentions } from '@renderer/hooks/useMentions'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'

describe('useMentions', () => {
  let mockApi: ReturnType<typeof createMockApiService>

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    mockApi = createMockApiService({
      getGroupParticipants: vi.fn().mockResolvedValue([
        { jid: 'p1@s.whatsapp.net', name: 'Member 1', isAdmin: false, isMe: false },
        { jid: 'p2@s.whatsapp.net', name: 'Member 2', isAdmin: true, isMe: false },
      ]),
    })
  })

  it('should fetch participants for group JIDs', async () => {
    const { result } = renderHook(() => useMentions('group123@g.us'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApi.getGroupParticipants).toHaveBeenCalledWith('group123@g.us')
    expect(result.current.participants).toHaveLength(2)
  })

  it('should not fetch participants for non-group JIDs', async () => {
    const { result } = renderHook(() => useMentions('user@s.whatsapp.net'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApi.getGroupParticipants).not.toHaveBeenCalled()
    expect(result.current.participants).toHaveLength(0)
  })

  it('should detect @ query in input and toggle menu', () => {
    const { result } = renderHook(() => useMentions('group123@g.us'), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.handleInputChange('@Mem', 4)
    })

    expect(result.current.showMenu).toBe(true)
    expect(result.current.query).toBe('Mem')

    act(() => {
      result.current.handleInputChange('@Mem ', 5)
    })

    expect(result.current.showMenu).toBe(false)
    expect(result.current.query).toBe('')
  })

  it('should manage mentioned JIDs state', () => {
    const { result } = renderHook(() => useMentions('group123@g.us'), {
      wrapper: createWrapper(),
    })

    const participant = { jid: 'p1@s.whatsapp.net', name: 'Member 1', isAdmin: false, isMe: false }

    act(() => {
      result.current.addMention(participant)
    })

    expect(result.current.mentionedJids.has('p1@s.whatsapp.net')).toBe(true)

    act(() => {
      result.current.clearMentions()
    })

    expect(result.current.mentionedJids.size).toBe(0)
  })

  it('drops a mention once its @token is edited out of the text (F6-03)', () => {
    const { result } = renderHook(() => useMentions('group123@g.us'), {
      wrapper: createWrapper(),
    })

    const participant = { jid: '12345@s.whatsapp.net', name: 'Alice', isAdmin: false, isMe: false }

    act(() => {
      result.current.addMention(participant)
    })
    expect(result.current.mentionedJids.has('12345@s.whatsapp.net')).toBe(true)

    // Token still present -> mention kept
    act(() => {
      result.current.handleInputChange('hey @12345 there', 16)
    })
    expect(result.current.mentionedJids.has('12345@s.whatsapp.net')).toBe(true)

    // Token backspaced away -> mention must be dropped
    act(() => {
      result.current.handleInputChange('hey there', 9)
    })
    expect(result.current.mentionedJids.has('12345@s.whatsapp.net')).toBe(false)
  })
})
