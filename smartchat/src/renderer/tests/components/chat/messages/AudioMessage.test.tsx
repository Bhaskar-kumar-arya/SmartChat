import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AudioMessage } from '@renderer/components/chat/messages/AudioMessage'
import { renderWithProviders } from '../../../testUtils'

// Mock WaveformPlayer
vi.mock('@renderer/components/common/WaveformPlayer', () => ({
  default: ({ url }: { url: string }) => <div data-testid="waveform-player">{url}</div>
}))

describe('AudioMessage', () => {
  it('renders download placeholder button when localURI is not available', () => {
    const handleDownload = vi.fn()
    render(<AudioMessage onDownload={handleDownload} isDownloading={false} />)

    expect(screen.getByText('Voice message')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Click to Download' })
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)
    expect(handleDownload).toHaveBeenCalledTimes(1)
  })

  it('renders downloading state when isDownloading is true', () => {
    render(<AudioMessage onDownload={vi.fn()} isDownloading={true} />)
    expect(screen.getByRole('button', { name: 'Downloading...' })).toBeDisabled()
  })

  it('renders WaveformPlayer and sender avatar when localURI is present', () => {
    renderWithProviders(
      <AudioMessage
        localURI="blob:voice-message"
        senderJid="1234567890@s.whatsapp.net"
        onDownload={vi.fn()}
        isDownloading={false}
        rawMsg={{
          audioMessage: {
            seconds: 45,
            waveform: new Uint8Array([100, 200, 255])
          }
        }}
      />
    )

    expect(screen.getByTestId('waveform-player')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-player')).toHaveTextContent('blob:voice-message')
  })
})
