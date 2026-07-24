import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import { SearchResultsPanel } from '@renderer/components/chat/SearchResultsPanel'
import { SearchResultItem } from '@renderer/types/chatTypes'

describe('SearchResultsPanel', () => {
  const dummyChats: SearchResultItem[] = [
    {
      type: 'chat',
      jid: 'alice@s.whatsapp.net',
      name: 'Alice Cooper',
      lastMessage: 'Hey there',
      timestamp: '1600000000'
    }
  ]

  const dummyMessages: SearchResultItem[] = [
    {
      type: 'message',
      jid: 'bob@s.whatsapp.net',
      name: 'Bob Smith',
      messageId: 'msg-99',
      snippet: 'Project meeting deadline update',
      timestamp: '1600000500',
      score: 0.88
    }
  ]

  const defaultProps = {
    chats: dummyChats,
    messages: dummyMessages,
    isSearching: false,
    query: 'meeting',
    activeJid: null,
    mode: 'normal' as const,
    onSelectChat: vi.fn()
  }

  it('renders loading state when isSearching is true', () => {
    renderWithProviders(<SearchResultsPanel {...defaultProps} isSearching={true} />)
    expect(screen.getByText('Searching...')).toBeInTheDocument()
  })

  it('renders deep search loading tip when in deep mode', () => {
    renderWithProviders(
      <SearchResultsPanel {...defaultProps} isSearching={true} mode="deep" />
    )
    expect(screen.getByText('Searching deeper meanings...')).toBeInTheDocument()
    expect(screen.getByText(/Use filters to speed up search/i)).toBeInTheDocument()
  })

  it('renders empty results message when no matches found', () => {
    renderWithProviders(
      <SearchResultsPanel
        {...defaultProps}
        chats={[]}
        messages={[]}
        query="nonexistent"
      />
    )
    expect(screen.getByText(/No results for/i)).toBeInTheDocument()
    expect(screen.getByText('nonexistent')).toBeInTheDocument()
  })

  it('renders chat and message results with highlighted text', () => {
    renderWithProviders(<SearchResultsPanel {...defaultProps} />)

    expect(screen.getByText('Chats')).toBeInTheDocument()
    expect(screen.getByText('Alice Cooper')).toBeInTheDocument()
    expect(screen.getByText('Messages')).toBeInTheDocument()
    expect(screen.getByText('Bob Smith')).toBeInTheDocument()

    const mark = document.querySelector('mark')
    expect(mark).toBeInTheDocument()
    expect(mark?.textContent).toBe('meeting')
  })

  it('displays deep search match percentage score badge when in deep mode', () => {
    renderWithProviders(<SearchResultsPanel {...defaultProps} mode="deep" />)

    expect(screen.getByText('88% match')).toBeInTheDocument()
  })

  it('invokes onSelectChat when clicking a chat result item', async () => {
    const user = userEvent.setup()
    const onSelectChat = vi.fn()
    renderWithProviders(
      <SearchResultsPanel {...defaultProps} onSelectChat={onSelectChat} />
    )

    const chatItem = screen.getByText('Alice Cooper')
    await user.click(chatItem)

    expect(onSelectChat).toHaveBeenCalledWith('alice@s.whatsapp.net', 'Alice Cooper', null)
  })

  it('invokes onSelectChat with messageId when clicking a message result item', async () => {
    const user = userEvent.setup()
    const onSelectChat = vi.fn()
    renderWithProviders(
      <SearchResultsPanel {...defaultProps} onSelectChat={onSelectChat} />
    )

    const msgItem = screen.getByText('Bob Smith')
    await user.click(msgItem)

    expect(onSelectChat).toHaveBeenCalledWith('bob@s.whatsapp.net', 'Bob Smith', 'msg-99')
  })
})
