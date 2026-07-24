import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, act } from '../../testUtils'
import ChatSearchSidebar from '@renderer/components/chat/ChatSearchSidebar'

describe('ChatSearchSidebar', () => {
  const defaultProps = {
    activeJid: 'chat-123@s.whatsapp.net',
    activeName: 'Project Group',
    isOpen: true,
    onClose: vi.fn(),
    onSelectMessage: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when isOpen is false', () => {
    const { container } = renderWithProviders(
      <ChatSearchSidebar {...defaultProps} isOpen={false} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders search sidebar header and inputs when open', () => {
    renderWithProviders(<ChatSearchSidebar {...defaultProps} />)

    expect(screen.getByText('Search Messages')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument()
    expect(screen.getByText('Custom Date Range')).toBeInTheDocument()
  })

  it('invokes api.searchAll after debounced query input', async () => {
    const { apiService } = renderWithProviders(<ChatSearchSidebar {...defaultProps} />)
    apiService.searchAll = vi.fn().mockResolvedValue({
      messages: [
        {
          jid: 'chat-123@s.whatsapp.net',
          messageId: 'msg-500',
          snippet: 'Important invoice details',
          timestamp: '1600000000',
          senderName: 'Alice'
        }
      ]
    })

    const input = screen.getByPlaceholderText('Search messages...')
    fireEvent.change(input, { target: { value: 'invoice' } })

    await act(async () => {
      vi.advanceTimersByTime(350)
    })

    expect(apiService.searchAll).toHaveBeenCalledWith('invoice', 'normal', {
      jids: ['chat-123@s.whatsapp.net']
    })

    expect(document.querySelector('.search-result-snippet')?.textContent).toBe('Important invoice details')
  })

  it('triggers quick date range filter selection', async () => {
    renderWithProviders(<ChatSearchSidebar {...defaultProps} />)

    const weekChip = screen.getByText('Last 7d')
    fireEvent.click(weekChip)

    const dateInputs = document.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>
    expect(dateInputs.length).toBe(2)
    expect(dateInputs[0].value).not.toBe('')
    expect(dateInputs[1].value).not.toBe('')
  })

  it('clears all filters when Clear Filters button is clicked', async () => {
    renderWithProviders(<ChatSearchSidebar {...defaultProps} />)

    const input = screen.getByPlaceholderText('Search messages...')
    fireEvent.change(input, { target: { value: 'test' } })

    const clearBtn = screen.getByText('Clear Filters')
    fireEvent.click(clearBtn)

    expect(input).toHaveValue('')
  })

  it('triggers onSelectMessage when clicking a search result item', async () => {
    const onSelectMessage = vi.fn()
    const { apiService } = renderWithProviders(
      <ChatSearchSidebar {...defaultProps} onSelectMessage={onSelectMessage} />
    )
    apiService.searchAll = vi.fn().mockResolvedValue({
      messages: [
        {
          jid: 'chat-123@s.whatsapp.net',
          messageId: 'target-msg-123',
          snippet: 'Found target message snippet',
          timestamp: '1600000000'
        }
      ]
    })

    const input = screen.getByPlaceholderText('Search messages...')
    fireEvent.change(input, { target: { value: 'target' } })

    await act(async () => {
      vi.advanceTimersByTime(350)
    })

    const resultItem = document.querySelector('.search-result-item') as HTMLElement
    expect(resultItem).toBeInTheDocument()
    fireEvent.click(resultItem)

    expect(onSelectMessage).toHaveBeenCalledWith('target-msg-123')
  })

  it('triggers onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    renderWithProviders(<ChatSearchSidebar {...defaultProps} onClose={onClose} />)

    const closeBtn = screen.getByTitle('Close search')
    fireEvent.click(closeBtn)

    expect(onClose).toHaveBeenCalled()
  })
})
