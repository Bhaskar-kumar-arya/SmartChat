import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SystemMessageBubble } from '@renderer/components/chat/messages/SystemMessage'
import { MessageItem } from '@renderer/types/chatTypes'

describe('SystemMessageBubble', () => {
  it('renders known system stub message from registry', () => {
    const msg: MessageItem = {
      id: 'sys-1',
      chatJid: 'group@g.us',
      participant: null,
      textContent: null,
      timestamp: '1620000000',
      fromMe: false,
      status: 'SENT',
      messageType: 'system',
      content: JSON.stringify({
        stubType: 'GROUP_CHANGE_SUBJECT',
        parameters: ['New Subject']
      })
    }

    render(<SystemMessageBubble msg={msg} />)
    expect(screen.getByText(/The subject was changed to/i)).toBeInTheDocument()
  })

  it('renders call message fallback when messageType is call', () => {
    const msg: MessageItem = {
      id: 'call-1',
      chatJid: 'user1@s.whatsapp.net',
      participant: null,
      textContent: null,
      timestamp: '1620000000',
      fromMe: false,
      status: 'SENT',
      messageType: 'call',
      content: JSON.stringify({
        callLog: { isVideo: true, isGroup: false }
      })
    }

    render(<SystemMessageBubble msg={msg} />)
    expect(screen.getByText(/Video Call/i)).toBeInTheDocument()
  })

  it('renders participant chips and handles chat selection callback', () => {
    const handleSelectChat = vi.fn()
    const msg: MessageItem = {
      id: 'sys-2',
      chatJid: 'group@g.us',
      participant: null,
      textContent: null,
      timestamp: '1620000000',
      fromMe: false,
      status: 'SENT',
      messageType: 'system',
      content: JSON.stringify({
        stubType: 'GROUP_PARTICIPANT_ACCEPT',
        parameters: [{ jid: '1234567890@s.whatsapp.net', name: '1234567890' }]
      })
    }

    render(<SystemMessageBubble msg={msg} onSelectChat={handleSelectChat} />)
    const chip = screen.getByText('1234567890')
    expect(chip).toBeInTheDocument()

    fireEvent.click(chip)
    expect(handleSelectChat).toHaveBeenCalledWith('1234567890@s.whatsapp.net', '1234567890')
  })

  it('handles invalid content JSON gracefully', () => {
    const msg: MessageItem = {
      id: 'sys-3',
      chatJid: 'group@g.us',
      participant: null,
      textContent: null,
      timestamp: '1620000000',
      fromMe: false,
      status: 'SENT',
      messageType: 'system',
      content: 'invalid-json{'
    }

    render(<SystemMessageBubble msg={msg} />)
    expect(screen.getByText('Group activity')).toBeInTheDocument()
  })
})
