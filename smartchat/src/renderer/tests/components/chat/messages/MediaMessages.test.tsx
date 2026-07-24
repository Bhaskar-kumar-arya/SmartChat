import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  ImageMessage,
  StickerMessage,
  VideoMessage,
  DocumentMessage
} from '@renderer/components/chat/messages/MediaMessages'
import { renderWithProviders } from '../../../testUtils'
import { createMockApiService } from '../../../mocks/mockApiService'

describe('MediaMessages', () => {
  describe('ImageMessage', () => {
    it('renders downloaded image and opens file on click', () => {
      const mockApi = createMockApiService()
      mockApi.openFile = vi.fn()

      renderWithProviders(
        <ImageMessage
          localURI="blob:image-url"
          rawMsg={{}}
          onDownload={vi.fn()}
          isDownloading={false}
        />,
        { apiService: mockApi }
      )

      const img = screen.getByRole('img', { name: 'Media' })
      expect(img).toBeInTheDocument()

      fireEvent.click(img.parentElement!)
      expect(mockApi.openFile).toHaveBeenCalledWith('blob:image-url')
    })

    it('renders download button overlay when localURI is missing but thumbnail exists', () => {
      const handleDownload = vi.fn()
      renderWithProviders(
        <ImageMessage
          onDownload={handleDownload}
          isDownloading={false}
          rawMsg={{
            imageMessage: {
              jpegThumbnail: 'base64thumbnail...',
              fileLength: 1048576,
              width: 800,
              height: 600
            }
          }}
        />
      )

      expect(screen.getByRole('img', { name: 'Preview' })).toBeInTheDocument()
      const downloadBtn = screen.getByTitle('Download Image')
      expect(downloadBtn).toBeInTheDocument()

      fireEvent.click(downloadBtn)
      expect(handleDownload).toHaveBeenCalled()
    })
  })

  describe('StickerMessage', () => {
    it('renders downloaded sticker and calls openFile on click', () => {
      const mockApi = createMockApiService()
      mockApi.openFile = vi.fn()

      renderWithProviders(
        <StickerMessage
          localURI="blob:sticker-url"
          rawMsg={{}}
          onDownload={vi.fn()}
          isDownloading={false}
        />,
        { apiService: mockApi }
      )

      const img = screen.getByRole('img', { name: 'Sticker' })
      fireEvent.click(img)
      expect(mockApi.openFile).toHaveBeenCalledWith('blob:sticker-url')
    })

    it('automatically triggers download if localURI is missing and not downloading', async () => {
      const handleDownload = vi.fn().mockResolvedValue(undefined)
      renderWithProviders(
        <StickerMessage
          rawMsg={{}}
          onDownload={handleDownload}
          isDownloading={false}
        />
      )

      await waitFor(() => {
        expect(handleDownload).toHaveBeenCalled()
      })
    })
  })

  describe('VideoMessage', () => {
    it('renders video element when localURI is present', () => {
      const { container } = renderWithProviders(
        <VideoMessage
          localURI="blob:video-url"
          rawMsg={{}}
          onDownload={vi.fn()}
          isDownloading={false}
        />
      )

      const video = container.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('src', 'blob:video-url')
    })
  })

  describe('DocumentMessage', () => {
    it('renders document name, size, and triggers openFile when localURI present', () => {
      const mockApi = createMockApiService()
      mockApi.openFile = vi.fn()

      renderWithProviders(
        <DocumentMessage
          localURI="C:/files/doc.pdf"
          onDownload={vi.fn()}
          isDownloading={false}
          rawMsg={{
            documentMessage: {
              fileName: 'Report.pdf',
              fileLength: 2097152,
              mimetype: 'application/pdf'
            }
          }}
        />,
        { apiService: mockApi }
      )

      expect(screen.getByText('Report.pdf')).toBeInTheDocument()
      expect(screen.getByText(/2.00 MB • PDF/i)).toBeInTheDocument()

      const btn = screen.getByRole('button')
      fireEvent.click(btn)
      expect(mockApi.openFile).toHaveBeenCalledWith('C:/files/doc.pdf')
    })
  })
})
