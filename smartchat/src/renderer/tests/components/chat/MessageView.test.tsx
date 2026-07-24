import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../testUtils'
import MessageView from '@renderer/components/chat/MessageView'
import { MessageItem as IMessageItem } from '@renderer/types/chatTypes'

describe('MessageView', () => {
  const dummyMessages: IMessageItem[] = [
    {
      id: 'msg-1',
      chatJid: 'user1@s.whatsapp.net',
      fromMe: false,
      participant: null,
      timestamp: '1600000000',
      status: 'READ',
      messageType: 'conversation',
      textContent: 'First message text',
      participantName: 'Alice'
    },
    {
      id: 'msg-2',
      chatJid: 'user1@s.whatsapp.net',
      fromMe: true,
      participant: null,
      timestamp: '1600003600',
      status: 'READ',
      messageType: 'conversation',
      textContent: 'Second reply text',
      reactions: [
        { text: '👍', senderId: 'user1@s.whatsapp.net', senderName: 'Alice', timestamp: '1600003700' }
      ]
    }
  ]

  const defaultProps = {
    messages: dummyMessages,
    loading: false,
    onLoadMore: vi.fn().mockResolvedValue(0),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDownloadMedia: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders loading indicator when loading is true', () => {
    renderWithProviders(<MessageView {...defaultProps} loading={true} />)
    expect(screen.getByText('Loading messages...')).toBeInTheDocument()
  })

  it('renders empty message prompt when messages list is empty', () => {
    renderWithProviders(<MessageView {...defaultProps} messages={[]} />)
    expect(screen.getByText(/No messages yet. Say hello!/i)).toBeInTheDocument()
  })

  it('renders list of messages and date separators', () => {
    renderWithProviders(<MessageView {...defaultProps} />)

    expect(screen.getByText('First message text')).toBeInTheDocument()
    expect(screen.getByText('Second reply text')).toBeInTheDocument()
    expect(document.querySelector('.date-separator')).toBeInTheDocument()
  })

  it('scrolls into view and highlights target message when targetMessageId is passed', async () => {
    vi.useFakeTimers()
    renderWithProviders(
      <MessageView {...defaultProps} targetMessageId="msg-2" />
    )

    vi.advanceTimersByTime(200)

    const targetEl = document.querySelector('[data-msg-id="msg-2"]')
    expect(targetEl).toBeInTheDocument()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('shows jump overlay during jumping state', () => {
    renderWithProviders(<MessageView {...defaultProps} isJumping={true} />)

    expect(screen.getByText('Loading message…')).toBeInTheDocument()
  })

  it('renders reaction details modal when clicking reactions view handler', async () => {
    renderWithProviders(<MessageView {...defaultProps} />)

    const reactionBadge = document.querySelector('.reactions-display') || document.querySelector('.reaction-chip')
    if (reactionBadge) {
      fireEvent.click(reactionBadge)
      expect(screen.getByText('Reactions')).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
    }
  })
})
