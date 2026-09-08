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
