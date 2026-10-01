import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '../../testUtils'
import MessageItem from '@renderer/components/chat/MessageItem'
import { createMockApiService } from '../../mocks/mockApiService'
import { MessageItem as IMessageItem } from '@renderer/types/chatTypes'

describe('MessageItem — reaction self-JID matching (F5-05)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  const baseMsg: IMessageItem = {
    id: 'm1',
    chatJid: 'group1@g.us',
    participant: 'other@s.whatsapp.net',
    fromMe: false,
    timestamp: '1600000000',
    status: 'READ',
    messageType: 'conversation',
    textContent: 'hi',
    reactions: [
      // device-suffixed self reaction — must still be recognized as mine
      { text: '👍', senderId: '5551234:7@s.whatsapp.net', senderName: 'x', timestamp: '1' }
    ]
  }

  it('toggles my own device-suffixed reaction off instead of re-adding it', async () => {
    const api = createMockApiService()
    api.getMyJid = vi.fn().mockResolvedValue('5551234@s.whatsapp.net')
    const reactSpy = vi.fn().mockResolvedValue(undefined)
    api.reactMessage = reactSpy

    renderWithProviders(
      <MessageItem
        msg={baseMsg}
        onReply={vi.fn()}
        onViewReactions={vi.fn()}
      />,
      { apiService: api }
    )

    await waitFor(() => expect(api.getMyJid).toHaveBeenCalled())

    fireEvent.click(screen.getByTitle('React to Message'))
    const thumbBtn = document.querySelectorAll('.quick-reaction-btn')[0] as HTMLElement
    fireEvent.click(thumbBtn)

    await waitFor(() => expect(reactSpy).toHaveBeenCalled())
    // '' == clear existing reaction
    expect(reactSpy).toHaveBeenCalledWith('group1@g.us', 'm1', '')
  })
})

describe('MessageItem — hooks order across normal/system flips (B-UICHAT-00)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  const normal: IMessageItem = {
    id: 'flip1',
    chatJid: 'chat@s.whatsapp.net',
    participant: 'other@s.whatsapp.net',
    fromMe: false,
    timestamp: '1600000000',
    status: 'READ',
    messageType: 'conversation',
    textContent: 'hello there'
  }
  const system: IMessageItem = {
    ...normal,
    messageType: 'system',
    textContent: '',
    content: JSON.stringify({ stubType: 'UNKNOWN' })
  }

  // The pre-branch hooks are context-only, so React 19 does not throw on the flip;
  // the early return instead skips the effects' cleanups (leaked document listener).
  it('does not leak effects when a message flips normal -> system -> normal', () => {
    const live = new Set<EventListenerOrEventListenerObject>()
    const addSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type, fn) => {
      if (type === 'mousedown') live.add(fn as EventListener)
    })
    const removeSpy = vi.spyOn(document, 'removeEventListener').mockImplementation((type, fn) => {
      if (type === 'mousedown') live.delete(fn as EventListener)
    })
    try {
      const props = { onReply: vi.fn(), onViewReactions: vi.fn() }
      const { rerender, unmount } = renderWithProviders(<MessageItem msg={normal} {...props} />)
      expect(screen.getByText('hello there')).toBeTruthy()
      expect(live.size).toBe(1)
      rerender(<MessageItem msg={system} {...props} />)
      expect(live.size).toBe(0)
      rerender(<MessageItem msg={normal} {...props} />)
      expect(screen.getByText('hello there')).toBeTruthy()
      expect(live.size).toBe(1)
      unmount()
      expect(live.size).toBe(0)
    } finally {
      addSpy.mockRestore()
      removeSpy.mockRestore()
    }
  })
})
