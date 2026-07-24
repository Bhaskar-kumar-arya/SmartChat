import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent, waitFor } from '../../testUtils'
import ExtensionManager from '@renderer/components/extensions/ExtensionManager'
import { createMockApiService } from '../../mocks/mockApiService'

describe('ExtensionManager', () => {
  const mockExtensions = [
    {
      id: 'ext-1',
      manifest: {
        id: 'ext-1',
        name: 'Weather Bot',
        version: '1.0.0',
        description: 'Provides weather updates',
        entry: 'index.js',
        permissions: []
      },
      isLoaded: true
    }
  ]

  it('does not render when isOpen is false', () => {
    const { container } = renderWithProviders(
      <ExtensionManager isOpen={false} onClose={vi.fn()} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders extension manager title and list when open', async () => {
    const apiService = createMockApiService({
      extensionList: vi.fn().mockResolvedValue(mockExtensions)
    })

    renderWithProviders(
      <ExtensionManager isOpen={true} onClose={vi.fn()} />,
      { apiService }
    )

    expect(screen.getByText('Extension Manager')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Weather Bot')).toBeInTheDocument()
    })
  })

  it('triggers file selection and install on Install button click', async () => {
    const user = userEvent.setup()
    const selectFile = vi.fn().mockResolvedValue(['/path/to/my-extension.scext'])
    const extensionInstall = vi.fn().mockResolvedValue({})
    const apiService = createMockApiService({
      selectFile,
      extensionInstall,
      extensionList: vi.fn().mockResolvedValue([])
    })

    renderWithProviders(
      <ExtensionManager isOpen={true} onClose={vi.fn()} />,
      { apiService }
    )

    const installBtn = screen.getByTitle('Install .scext package')
    await user.click(installBtn)

    expect(selectFile).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(extensionInstall).toHaveBeenCalledWith('/path/to/my-extension.scext')
    })
  })

  it('calls onClose when close icon button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <ExtensionManager isOpen={true} onClose={onClose} />,
      { apiService: createMockApiService({ extensionList: vi.fn().mockResolvedValue([]) }) }
    )

    const closeBtn = screen.getByTitle('Close')
    await user.click(closeBtn)

    expect(onClose).toHaveBeenCalledOnce()
  })
})
