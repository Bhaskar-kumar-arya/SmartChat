import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { AudioMessage } from '@renderer/components/chat/messages/AudioMessage'
import { DocumentMessage } from '@renderer/components/chat/messages/MediaMessages'
import { renderWithProviders } from '../../../testUtils'

vi.mock('@renderer/components/common/WaveformPlayer', () => ({
  default: () => <div data-testid="waveform-player" />
}))

describe('Audio/Document download failures (B-UICHAT-11)', () => {
  it('AudioMessage shows an expired state when the download rejects', async () => {
    const onDownload = vi.fn().mockRejectedValue(new Error('expired'))
    renderWithProviders(<AudioMessage onDownload={onDownload} isDownloading={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Click to Download' }))

    await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument())
  })

  it('DocumentMessage shows an expired state when the download rejects', async () => {
    const onDownload = vi.fn().mockRejectedValue(new Error('expired'))
    renderWithProviders(
      <DocumentMessage
        onDownload={onDownload}
        isDownloading={false}
        rawMsg={{ documentMessage: { fileName: 'Report.pdf', mimetype: 'application/pdf' } }}
      />
    )

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument())
  })
})
