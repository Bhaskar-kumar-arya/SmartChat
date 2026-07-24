import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent, waitFor } from '../../testUtils'
import AIChatExportButton from '@renderer/components/ai/AIChatExportButton'
import { createMockApiService } from '../../mocks/mockApiService'

describe('AIChatExportButton', () => {
  it('disables buttons when there is no active session', () => {
    renderWithProviders(
      <AIChatExportButton
        activeSessionId={null}
        messages={[{ id: '1', content: 'hello' }]}
        sessions={[]}
      />
    )

    const buttons = screen.getAllByRole('button')
    // Export, Clone, Delete buttons should all be disabled
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled()
    })
  })

  it('calls exportAiChat when export button is clicked', async () => {
    const user = userEvent.setup()
    const exportAiChat = vi.fn().mockResolvedValue(undefined)
    const apiService = createMockApiService({ exportAiChat })

    renderWithProviders(
      <AIChatExportButton
        activeSessionId="session-1"
        messages={[{ id: '1', content: 'hello' }]}
        sessions={[{ id: 'session-1', title: 'Test Session' }]}
      />,
      { apiService }
    )

    const exportBtn = screen.getByTitle('Export/Update JSON')
    expect(exportBtn).not.toBeDisabled()

    await user.click(exportBtn)
    expect(exportAiChat).toHaveBeenCalledWith(
      { id: 'session-1', title: 'Test Session' },
      [{ id: '1', content: 'hello' }]
    )
  })

  it('calls cloneSession and onSessionCloned when clone button is clicked', async () => {
    const user = userEvent.setup()
    const cloneSession = vi.fn().mockResolvedValue({ id: 'cloned-session-id' })
    const onSessionCloned = vi.fn()

    renderWithProviders(
      <AIChatExportButton
        activeSessionId="session-1"
        messages={[{ id: '1', content: 'hello' }]}
        sessions={[{ id: 'session-1', title: 'Test Session' }]}
        cloneSession={cloneSession}
        onSessionCloned={onSessionCloned}
      />
    )

    const cloneBtn = screen.getByTitle('Clone Session')
    await user.click(cloneBtn)

    expect(cloneSession).toHaveBeenCalledWith('session-1')
    await waitFor(() => {
      expect(onSessionCloned).toHaveBeenCalledWith('cloned-session-id')
    })
  })

  it('shows delete confirmation modal and calls deleteExportedAiChat when confirmed', async () => {
    const user = userEvent.setup()
    const deleteExportedAiChat = vi.fn().mockResolvedValue(undefined)
    const apiService = createMockApiService({ deleteExportedAiChat })

    renderWithProviders(
      <AIChatExportButton
        activeSessionId="session-1"
        messages={[{ id: '1', content: 'hello' }]}
        sessions={[{ id: 'session-1', title: 'Test Session' }]}
      />,
      { apiService }
    )

    const deleteBtn = screen.getByTitle('Remove from JSON')
    await user.click(deleteBtn)

    // Confirm modal should appear
    expect(screen.getByText('Remove from exports?')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: 'Delete' })
    await user.click(confirmBtn)

    expect(deleteExportedAiChat).toHaveBeenCalledWith('session-1')
  })
})
