import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SettingsModal from '@renderer/components/common/SettingsModal'
import { renderWithProviders } from '../../testUtils'
import { createMockApiService } from '../../mocks/mockApiService'

describe('SettingsModal', () => {
  it('returns null when isOpen is false', () => {
    const { container } = renderWithProviders(<SettingsModal isOpen={false} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('fetches notification preferences and renders settings form when open', async () => {
    const handleClose = vi.fn()
    const mockApi = createMockApiService()
    mockApi.getNotificationPreferences = vi.fn().mockResolvedValue({
      enabled: true,
      soundEnabled: true,
      notifyWhenFocused: false,
      minimizeToTray: true,
      launchOnStartup: true
    })

    renderWithProviders(<SettingsModal isOpen={true} onClose={handleClose} />, { apiService: mockApi })

    await waitFor(() => {
      expect(screen.getByText('General Settings')).toBeInTheDocument()
      expect(screen.getByText('Desktop Notifications')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.length).toBe(5)
  })

  it('updates notification preference when checkbox is toggled', async () => {
    const mockApi = createMockApiService()
    mockApi.getNotificationPreferences = vi.fn().mockResolvedValue({
      enabled: true,
      soundEnabled: true,
      notifyWhenFocused: false,
      minimizeToTray: true,
      launchOnStartup: true
    })
    mockApi.setNotificationPreferences = vi.fn().mockResolvedValue(true)

    renderWithProviders(<SettingsModal isOpen={true} onClose={vi.fn()} />, { apiService: mockApi })

    await waitFor(() => {
      expect(screen.getByText('General Settings')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    fireEvent.click(checkboxes[0]) // Minimize to Tray

    expect(mockApi.setNotificationPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ minimizeToTray: false })
    )
  })

  it('reverts an optimistic toggle when the save rejects (F10-06)', async () => {
    const mockApi = createMockApiService()
    mockApi.getNotificationPreferences = vi.fn().mockResolvedValue({
      enabled: true,
      soundEnabled: true,
      notifyWhenFocused: false,
      minimizeToTray: true,
      launchOnStartup: true
    })
    mockApi.setNotificationPreferences = vi.fn().mockRejectedValue(new Error('disk full'))

    renderWithProviders(<SettingsModal isOpen={true} onClose={vi.fn()} />, { apiService: mockApi })

    await waitFor(() => {
      expect(screen.getByText('General Settings')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes[0].checked).toBe(true) // minimizeToTray
    fireEvent.click(checkboxes[0])

    await waitFor(() => {
      const after = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(after[0].checked).toBe(true) // reverted
    })
  })

  it('calls onClose when Done button is clicked', async () => {
    const handleClose = vi.fn()
    const mockApi = createMockApiService()
    mockApi.getNotificationPreferences = vi.fn().mockResolvedValue({
      enabled: true,
      soundEnabled: true,
      notifyWhenFocused: false,
      minimizeToTray: true,
      launchOnStartup: true
    })

    renderWithProviders(<SettingsModal isOpen={true} onClose={handleClose} />, { apiService: mockApi })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
