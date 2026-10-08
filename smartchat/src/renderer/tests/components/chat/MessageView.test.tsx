import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, makeMessage, act } from '../../testUtils'
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

  it('recovers pagination lock after onLoadMore rejects [F5-03]', async () => {
    const rejecting = vi.fn().mockRejectedValue(new Error('backend down'))
    const { container } = renderWithProviders(
      <MessageView {...defaultProps} onLoadMore={rejecting} />
    )
    const view = container.querySelector('.message-view') as HTMLElement
    Object.defineProperty(view, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(view, 'clientHeight', { value: 500, configurable: true })
    view.scrollTop = 0

    fireEvent.scroll(view)
    await new Promise((r) => setTimeout(r, 0))
    expect(rejecting).toHaveBeenCalledTimes(1)

    // A second scroll near the top must still trigger another load attempt —
    // the lock was released despite the rejection.
    fireEvent.scroll(view)
    await new Promise((r) => setTimeout(r, 0))
    expect(rejecting).toHaveBeenCalledTimes(2)
  })

  it('does not mutate the shared message.reactions array when opening the modal [F5-07]', () => {
    // Own fixture: never mutate the shared dummyMessages (it leaked into later tests).
    const msg = makeMessage({
      fromMe: true,
      reactions: [
        { text: '👍', senderId: 'a@s.whatsapp.net', senderName: 'A', timestamp: '100' },
        { text: '❤️', senderId: 'b@s.whatsapp.net', senderName: 'B', timestamp: '200' }
      ]
    })
    const before = msg.reactions!.map((r) => r.text)
    renderWithProviders(<MessageView {...defaultProps} messages={[makeMessage(), msg]} />)
    const badge = document.querySelector('.message-reactions')
    expect(badge).toBeInTheDocument()
    fireEvent.click(badge as Element)
    // The modal really opened (so the sort path ran) ...
    expect(screen.getByText('Reactions')).toBeInTheDocument()
    // ... and the shared array was left untouched.
    expect(msg.reactions!.map((r) => r.text)).toEqual(before)
  })

  it('renders reaction details modal when clicking reactions view handler', async () => {
    renderWithProviders(<MessageView {...defaultProps} />)

    const reactionBadge = document.querySelector('.message-reactions')
    expect(reactionBadge).toBeInTheDocument()
    fireEvent.click(reactionBadge as Element)
    expect(screen.getByText('Reactions')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  describe('jumped window (F-UC-1)', () => {
    const setGeometry = (el: Element, scrollTop: number, scrollHeight: number, clientHeight: number): void => {
      Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true })
      Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
      Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
    }

    it('scrolling to the bottom of a jumped window asks for newer messages', async () => {
      const onLoadNewer = vi.fn().mockResolvedValue(10)
      renderWithProviders(<MessageView {...defaultProps} hasNewer onLoadNewer={onLoadNewer} />)
      const view = document.querySelector('.message-view') as Element
      setGeometry(view, 800, 1000, 100)
      await act(async () => { await Promise.resolve() })
      onLoadNewer.mockClear()
      fireEvent.scroll(view)
      expect(onLoadNewer).toHaveBeenCalledTimes(1)
    })

    it('does not ask for newer messages when the window is complete (hasNewer=false)', async () => {
      const onLoadNewer = vi.fn().mockResolvedValue(0)
      renderWithProviders(<MessageView {...defaultProps} onLoadNewer={onLoadNewer} />)
      const view = document.querySelector('.message-view') as Element
      setGeometry(view, 900, 1000, 100)
      fireEvent.scroll(view)
      expect(onLoadNewer).not.toHaveBeenCalled()
    })

    it('the Latest pill reloads the newest page when newer messages are not loaded', async () => {
      const onJumpToLatest = vi.fn().mockResolvedValue(undefined)
      renderWithProviders(<MessageView {...defaultProps} hasNewer onLoadNewer={vi.fn().mockResolvedValue(0)} onJumpToLatest={onJumpToLatest} />)
      const view = document.querySelector('.message-view') as Element
      setGeometry(view, 0, 2000, 100)
      fireEvent.scroll(view)
      fireEvent.click(await screen.findByTitle('Jump to latest messages'))
      expect(onJumpToLatest).toHaveBeenCalledTimes(1)
    })

    it('the Latest pill just scrolls when the newest messages are already loaded', async () => {
      const onJumpToLatest = vi.fn().mockResolvedValue(undefined)
      renderWithProviders(<MessageView {...defaultProps} onJumpToLatest={onJumpToLatest} />)
      const view = document.querySelector('.message-view') as Element
      setGeometry(view, 0, 2000, 100)
      fireEvent.scroll(view)
      fireEvent.click(await screen.findByTitle('Jump to latest messages'))
      expect(onJumpToLatest).not.toHaveBeenCalled()
    })
  })
})
