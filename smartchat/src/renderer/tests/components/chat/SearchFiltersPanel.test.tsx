import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import { SearchFiltersPanel } from '@renderer/components/chat/SearchFiltersPanel'
import { SearchFilters, SearchMode } from '@renderer/types/chatTypes'

describe('SearchFiltersPanel', () => {
  const dummyChats = [
    { jid: '123@s.whatsapp.net', name: 'Alice' },
    { jid: '456@s.whatsapp.net', name: 'Bob' },
    { jid: '789@g.us', name: 'Dev Team' }
  ]

  const defaultProps = {
    filters: {} as SearchFilters,
    onFiltersChange: vi.fn(),
    chats: dummyChats,
    mode: 'normal' as SearchMode,
    onModeChange: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders search mode toggle and filter sections', () => {
    renderWithProviders(<SearchFiltersPanel {...defaultProps} />)

    expect(screen.getByText('Search Mode')).toBeInTheDocument()
    expect(screen.getByText('Deep Search ✦')).toBeInTheDocument()
    expect(screen.getByText('Chats / Contacts')).toBeInTheDocument()
    expect(screen.getByText('Date Range')).toBeInTheDocument()
  })

  it('toggles deep search mode checkbox', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    renderWithProviders(<SearchFiltersPanel {...defaultProps} onModeChange={onModeChange} />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)
    expect(onModeChange).toHaveBeenCalledWith('deep')
  })

  it('opens chat selection dropdown and allows selecting specific chats', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    renderWithProviders(
      <SearchFiltersPanel {...defaultProps} onFiltersChange={onFiltersChange} />
    )

    const dropdownBtn = screen.getByText('All chats')
    await user.click(dropdownBtn)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Dev Team')).toBeInTheDocument()

    const aliceCheckbox = screen.getAllByRole('checkbox')[1] // 0 is mode
    await user.click(aliceCheckbox)

    expect(onFiltersChange).toHaveBeenCalledWith({ jids: ['123@s.whatsapp.net'] })
  })

  it('allows clicking Select All in chat dropdown', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    renderWithProviders(
      <SearchFiltersPanel {...defaultProps} onFiltersChange={onFiltersChange} />
    )

    await user.click(screen.getByText('All chats'))
    const selectAllBtn = screen.getByText('Select All')
    await user.click(selectAllBtn)

    expect(onFiltersChange).toHaveBeenCalledWith({
      jids: ['123@s.whatsapp.net', '456@s.whatsapp.net', '789@g.us']
    })
  })

  it('triggers range calculation when quick range chips are clicked', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    renderWithProviders(
      <SearchFiltersPanel {...defaultProps} onFiltersChange={onFiltersChange} />
    )

    const todayChip = screen.getByText('Today')
    await user.click(todayChip)

    expect(onFiltersChange).toHaveBeenCalled()
    const callArg = onFiltersChange.mock.calls[0][0]
    expect(callArg.fromDate).toBeDefined()
    expect(callArg.toDate).toBeDefined()
  })

  it('renders clear button when date range filter is active', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    const activeFilters: SearchFilters = {
      fromDate: '2026-01-01T00:00:00.000Z',
      toDate: '2026-01-31T23:59:59.000Z'
    }

    renderWithProviders(
      <SearchFiltersPanel
        {...defaultProps}
        filters={activeFilters}
        onFiltersChange={onFiltersChange}
      />
    )

    const clearBtn = screen.getByText('Clear')
    await user.click(clearBtn)

    expect(onFiltersChange).toHaveBeenCalledWith({ fromDate: undefined, toDate: undefined })
  })
})
