import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProfilePicture } from '@renderer/components/common/ProfilePicture'
import { renderWithProviders } from '../../testUtils'
import { createMockApiService } from '../../mocks/mockApiService'

describe('ProfilePicture', () => {
  it('renders image when initialUrl is provided', () => {
    renderWithProviders(<ProfilePicture jid="12345@s.whatsapp.net" initialUrl="http://example.com/avatar.jpg" />)
    const img = screen.getByRole('img', { name: 'Profile' }) as HTMLImageElement
    expect(img).toBeInTheDocument()
    expect(img.src).toBe('http://example.com/avatar.jpg')
  })

  it('fetches profile picture via API when initialUrl is not provided', async () => {
    const mockApi = createMockApiService()
    mockApi.getProfilePicture = vi.fn().mockResolvedValue('http://example.com/fetched-avatar.jpg')

    renderWithProviders(<ProfilePicture jid="12345@s.whatsapp.net" />, { apiService: mockApi })

    await waitFor(() => {
      const img = screen.getByRole('img', { name: 'Profile' }) as HTMLImageElement
      expect(img.src).toBe('http://example.com/fetched-avatar.jpg')
    })
    expect(mockApi.getProfilePicture).toHaveBeenCalledWith('12345@s.whatsapp.net', 'preview')
  })

  it('renders fallback user icon when no profile picture and fetch returns null', async () => {
    const mockApi = createMockApiService()
    mockApi.getProfilePicture = vi.fn().mockResolvedValue(null)

    renderWithProviders(<ProfilePicture jid="12345@s.whatsapp.net" />, { apiService: mockApi })

    await waitFor(() => {
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })
  })

  it('renders group fallback icon when jid ends with @g.us', async () => {
    const mockApi = createMockApiService()
    mockApi.getProfilePicture = vi.fn().mockResolvedValue(null)

    const { container } = renderWithProviders(<ProfilePicture jid="1234567@g.us" />, { apiService: mockApi })

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })
  })

  it('attempts to refresh picture on image error and falls back if second attempt fails', async () => {
    const mockApi = createMockApiService()
    mockApi.getProfilePicture = vi.fn().mockRejectedValue(new Error('Failed refresh'))

    renderWithProviders(
      <ProfilePicture jid="12345@s.whatsapp.net" initialUrl="http://example.com/broken.jpg" />,
      { apiService: mockApi }
    )

    const img = screen.getByRole('img', { name: 'Profile' })
    fireEvent.error(img)

    await waitFor(() => {
      expect(mockApi.getProfilePicture).toHaveBeenCalledWith('12345@s.whatsapp.net', 'preview', true)
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })
  })

  it('handles click callback', () => {
    const handleClick = vi.fn()
    renderWithProviders(
      <ProfilePicture jid="12345@s.whatsapp.net" initialUrl="http://example.com/avatar.jpg" onClick={handleClick} />
    )
    fireEvent.click(screen.getByRole('img'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
