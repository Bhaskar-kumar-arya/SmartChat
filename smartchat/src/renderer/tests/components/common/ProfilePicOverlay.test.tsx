import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProfilePicOverlay } from '@renderer/components/common/ProfilePicOverlay'
import { renderWithProviders } from '../../testUtils'
import { createMockApiService } from '../../mocks/mockApiService'

describe('ProfilePicOverlay', () => {
  it('loads and displays full resolution profile picture', async () => {
    const handleClose = vi.fn()
    const mockApi = createMockApiService()
    mockApi.getProfilePicture = vi.fn().mockResolvedValue('http://example.com/full.jpg')

    renderWithProviders(
      <ProfilePicOverlay jid="12345@s.whatsapp.net" name="Alice" onClose={handleClose} />,
      { apiService: mockApi }
    )

    await waitFor(() => {
      const img = screen.getByRole('img', { name: 'Alice' }) as HTMLImageElement
      expect(img).toBeInTheDocument()
      expect(img.src).toBe('http://example.com/full.jpg')
    })
  })

  it('shows no profile picture notice when image is null', async () => {
    const handleClose = vi.fn()
    const mockApi = createMockApiService()
    mockApi.getProfilePicture = vi.fn().mockResolvedValue(null)

    renderWithProviders(
      <ProfilePicOverlay jid="12345@s.whatsapp.net" name="Alice" onClose={handleClose} />,
      { apiService: mockApi }
    )

    await waitFor(() => {
      expect(screen.getByText('No profile picture available')).toBeInTheDocument()
    })
  })

  it('triggers onClose when close button is clicked', async () => {
    const handleClose = vi.fn()
    const mockApi = createMockApiService()
    mockApi.getProfilePicture = vi.fn().mockResolvedValue('http://example.com/full.jpg')

    renderWithProviders(
      <ProfilePicOverlay jid="12345@s.whatsapp.net" name="Alice" onClose={handleClose} />,
      { apiService: mockApi }
    )

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Alice' })).toBeInTheDocument()
    })

    const closeBtn = screen.getByRole('button')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
