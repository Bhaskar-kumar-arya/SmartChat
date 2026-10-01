import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, waitFor, act } from '../../testUtils'
import { createMockApiService } from '../../mocks/mockApiService'
import ChatList from '@renderer/components/chat/ChatList'

describe('ChatList indexing (B-UICHAT-14)', () => {
  const defaultProps = {
    activeJid: null,
    onSelectChat: vi.fn(),
    onShowProfilePic: vi.fn(),
    onOpenExtensionChat: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a toast and does not start indexing when clearVectors rejects', async () => {
    const api = createMockApiService()
    api.getChats = vi.fn().mockResolvedValue([])
    api.clearVectors = vi.fn().mockRejectedValue(new Error('clear exploded'))

    renderWithProviders(<ChatList {...defaultProps} />, { apiService: api })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    fireEvent.click(screen.getByTitle('Index for Semantic Search'))
    fireEvent.click(document.getElementById('clear-vectors-checkbox') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Start Indexing' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('clear exploded')
    await waitFor(() => expect(api.clearVectors).toHaveBeenCalled())
    expect(api.indexEmbeddings).not.toHaveBeenCalled()
  })
})
