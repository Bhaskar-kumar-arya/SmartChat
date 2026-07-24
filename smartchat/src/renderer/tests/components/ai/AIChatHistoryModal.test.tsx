import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import AIChatHistoryModal from '@renderer/components/ai/AIChatHistoryModal'

describe('AIChatHistoryModal', () => {
  const mockSessions = [
    {
      id: 'session-1',
      title: 'First Chat Session',
      modelId: 'gemini-pro',
      createdAt: '1700000000000',
      updatedAt: '1700000000000'
    },
    {
      id: 'session-2',
      title: 'Second Chat Session',
      modelId: 'gpt-4o',
      createdAt: '1700000500000',
      updatedAt: '1700000500000'
    }
  ]

  it('does not render when isOpen is false', () => {
    const { container } = renderWithProviders(
      <AIChatHistoryModal
        isOpen={false}
        onClose={vi.fn()}
        sessions={mockSessions}
        activeSessionId="session-1"
        onSelectSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders sessions list when open', () => {
    renderWithProviders(
      <AIChatHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        sessions={mockSessions}
        activeSessionId="session-1"
        onSelectSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    )

    expect(screen.getByText('Chat History')).toBeInTheDocument()
    expect(screen.getByText('First Chat Session')).toBeInTheDocument()
    expect(screen.getByText('Second Chat Session')).toBeInTheDocument()
  })

  it('renders empty message when no sessions exist', () => {
    renderWithProviders(
      <AIChatHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        sessions={[]}
        activeSessionId={null}
        onSelectSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    )

    expect(screen.getByText('No chat history yet.')).toBeInTheDocument()
  })

  it('selects session when item is clicked', async () => {
    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(
      <AIChatHistoryModal
        isOpen={true}
        onClose={onClose}
        sessions={mockSessions}
        activeSessionId="session-1"
        onSelectSession={onSelectSession}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    )

    await user.click(screen.getByText('Second Chat Session'))
    expect(onSelectSession).toHaveBeenCalledWith('session-2')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renames session on edit submit', async () => {
    const user = userEvent.setup()
    const onRenameSession = vi.fn()

    renderWithProviders(
      <AIChatHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        sessions={mockSessions}
        activeSessionId="session-1"
        onSelectSession={vi.fn()}
        onRenameSession={onRenameSession}
        onDeleteSession={vi.fn()}
      />
    )

    // Click edit button for first session
    const editBtns = screen.getAllByRole('button').filter(b => b.className.includes('ai-history-item-btn') && !b.className.includes('delete'))
    await user.click(editBtns[0])

    const input = screen.getByDisplayValue('First Chat Session')
    await user.clear(input)
    await user.type(input, 'Renamed Session{Enter}')

    expect(onRenameSession).toHaveBeenCalledWith('session-1', 'Renamed Session')
  })

  it('opens delete confirm modal and triggers onDeleteSession', async () => {
    const user = userEvent.setup()
    const onDeleteSession = vi.fn()

    renderWithProviders(
      <AIChatHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        sessions={mockSessions}
        activeSessionId="session-1"
        onSelectSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={onDeleteSession}
      />
    )

    // Click delete icon for first session
    const deleteBtns = screen.getAllByRole('button').filter(b => b.className.includes('delete'))
    await user.click(deleteBtns[0])

    expect(screen.getByText('Delete this session?')).toBeInTheDocument()

    const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete' })
    await user.click(confirmDeleteBtn)

    expect(onDeleteSession).toHaveBeenCalledWith('session-1')
  })
})
