import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../testUtils'
import { CitationPill } from '@renderer/components/ai/CitationPill'
import { createMockApiService } from '../../mocks/mockApiService'

describe('CitationPill', () => {
  it('renders loading state initially and then displays resolved entity label', async () => {
    const mockEntity = {
      type: 'message',
      targetJid: 'user@s.whatsapp.net',
      messageId: 'msg-123',
      snippet: 'Hello world'
    }

    const apiService = createMockApiService({
      resolveCitation: vi.fn().mockResolvedValue(mockEntity)
    })

    renderWithProviders(
      <CitationPill index={1} anchorText="Source 1" sessionId="session-1" />,
      { apiService }
    )

    // Should resolve and display anchor text
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /citation 1: source 1/i })).toBeInTheDocument()
    })

    const button = screen.getByRole('button', { name: /citation 1: source 1/i })
    expect(button).not.toBeDisabled()
  })

  it('renders icon when anchorText is empty', async () => {
    const mockEntity = {
      type: 'message',
      targetJid: 'user@s.whatsapp.net',
      messageId: 'msg-123',
      snippet: 'Hello'
    }

    const apiService = createMockApiService({
      resolveCitation: vi.fn().mockResolvedValue(mockEntity)
    })

    renderWithProviders(
      <CitationPill index={2} sessionId="session-1" />,
      { apiService }
    )

    await waitFor(() => {
      expect(screen.getByRole('button')).not.toBeDisabled()
    })
  })

  it('remains disabled if citation entity resolves to null', async () => {
    const apiService = createMockApiService({
      resolveCitation: vi.fn().mockResolvedValue(null)
    })

    renderWithProviders(
      <CitationPill index={99} anchorText="Missing" sessionId="session-1" />,
      { apiService }
    )

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })
})
