import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import AIChatSidebar from '@renderer/components/ai/AIChatSidebar'

describe('AIChatSidebar', () => {
  it('does not render when isOpen is false', () => {
    const { container } = renderWithProviders(
      <AIChatSidebar isOpen={false} onClose={vi.fn()} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders sidebar layout when isOpen is true', () => {
    renderWithProviders(
      <AIChatSidebar isOpen={true} onClose={vi.fn()} />
    )

    expect(screen.getByText('AI Assistant')).toBeInTheDocument()
    expect(screen.getByText('How can I help you today?')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Ask AI…/i)).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <AIChatSidebar isOpen={true} onClose={onClose} />
    )

    const closeBtn = screen.getByTitle('Close Sidebar')
    await user.click(closeBtn)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens AISettingsModal when settings button is clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <AIChatSidebar isOpen={true} onClose={vi.fn()} />
    )

    const settingsBtn = screen.getByTitle('Settings')
    await user.click(settingsBtn)

    expect(screen.getByText('AI Preferences')).toBeInTheDocument()
  })

  it('opens AIChatHistoryModal when history button is clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <AIChatSidebar isOpen={true} onClose={vi.fn()} />
    )

    const historyBtn = screen.getByTitle('History')
    await user.click(historyBtn)

    expect(screen.getByText('Chat History')).toBeInTheDocument()
  })
})
