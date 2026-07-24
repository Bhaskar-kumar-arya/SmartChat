import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../testUtils'
import { ExtensionLogViewer } from '@renderer/components/extensions/ExtensionLogViewer'
import { createMockApiService } from '../../mocks/mockApiService'

describe('ExtensionLogViewer', () => {
  it('renders empty message when no extension is selected', () => {
    renderWithProviders(<ExtensionLogViewer extensionId={null} />)

    expect(screen.getByText('Select an extension to view its log')).toBeInTheDocument()
  })

  it('fetches and renders log output when extensionId is provided', async () => {
    const apiService = createMockApiService({
      extensionGetLog: vi.fn().mockResolvedValue('[LOG] Extension initialized successfully\n[INFO] Listening on events')
    })

    renderWithProviders(<ExtensionLogViewer extensionId="ext-1" />, { apiService })

    expect(screen.getByText('Live Log')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Extension initialized successfully/i)).toBeInTheDocument()
    })
  })
})
