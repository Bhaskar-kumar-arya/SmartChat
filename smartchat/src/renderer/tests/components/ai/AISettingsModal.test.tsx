import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import AISettingsModal from '@renderer/components/ai/AISettingsModal'
import { createMockApiService } from '../../mocks/mockApiService'

describe('AISettingsModal', () => {
  const mockOptions = {
    useThinkMode: true,
    model: 'gemini:gemma-4-31b-it',
    contextLength: 24576,
    autoSaveChats: true
  }

  const mockModels = [
    { id: 'gemini:gemma-4-31b-it', name: 'Gemma 4 31B', provider: 'gemini', description: 'Google Cloud', isLocal: false },
    { id: 'groq:llama-3-70b', name: 'Llama 3 70B', provider: 'groq', description: 'Groq Cloud', isLocal: false }
  ]

  it('does not render when isOpen is false', () => {
    const { container } = renderWithProviders(
      <AISettingsModal
        isOpen={false}
        onClose={vi.fn()}
        options={mockOptions}
        onOptionsChange={vi.fn()}
        availableModels={mockModels}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders preference controls when open', () => {
    renderWithProviders(
      <AISettingsModal
        isOpen={true}
        onClose={vi.fn()}
        options={mockOptions}
        onOptionsChange={vi.fn()}
        availableModels={mockModels}
      />
    )

    expect(screen.getByText('AI Preferences')).toBeInTheDocument()
    expect(screen.getByText('Thinking Mode (ReAct)')).toBeInTheDocument()
    expect(screen.getByText('AI Provider')).toBeInTheDocument()
    expect(screen.getByText('Store Chat History')).toBeInTheDocument()
  })

  it('toggles thinking mode checkbox', async () => {
    const user = userEvent.setup()
    const onOptionsChange = vi.fn()

    renderWithProviders(
      <AISettingsModal
        isOpen={true}
        onClose={vi.fn()}
        options={mockOptions}
        onOptionsChange={onOptionsChange}
        availableModels={mockModels}
      />
    )

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])

    expect(onOptionsChange).toHaveBeenCalledWith({
      ...mockOptions,
      useThinkMode: false
    })
  })

  it('handles provider selection change', async () => {
    const user = userEvent.setup()
    const onOptionsChange = vi.fn()

    renderWithProviders(
      <AISettingsModal
        isOpen={true}
        onClose={vi.fn()}
        options={mockOptions}
        onOptionsChange={onOptionsChange}
        availableModels={mockModels}
      />
    )

    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'groq')

    expect(onOptionsChange).toHaveBeenCalledWith({
      ...mockOptions,
      model: 'groq:llama-3-70b'
    })
  })

  it('updates provider API key via apiService', async () => {
    const user = userEvent.setup()
    const setProviderKey = vi.fn().mockResolvedValue(true)
    const apiService = createMockApiService({ setProviderKey })

    renderWithProviders(
      <AISettingsModal
        isOpen={true}
        onClose={vi.fn()}
        options={mockOptions}
        onOptionsChange={vi.fn()}
        availableModels={mockModels}
      />,
      { apiService }
    )

    const keyInput = screen.getByPlaceholderText(/Enter custom gemini API key/i)
    await user.type(keyInput, 'secret-key-123')

    expect(setProviderKey).toHaveBeenCalled()
  })

  it('triggers onClose when Done button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <AISettingsModal
        isOpen={true}
        onClose={onClose}
        options={mockOptions}
        onOptionsChange={vi.fn()}
        availableModels={mockModels}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
