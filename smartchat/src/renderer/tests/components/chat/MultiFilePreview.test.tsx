import { render, screen, fireEvent } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { renderWithProviders, waitFor } from '../../testUtils'
import { createMockApiService } from '../../mocks/mockApiService'
import { describe, it, expect, vi } from 'vitest'
import MultiFilePreview from '@renderer/components/chat/MultiFilePreview'
import { StagedFile } from '@renderer/hooks/useMultiFileQueue'

describe('MultiFilePreview', () => {
  const sampleFiles: StagedFile[] = [
    { name: 'photo.jpg', path: 'C:\\images\\photo.jpg', ext: 'jpg', caption: 'My photo' },
    { name: 'document.pdf', path: 'C:\\docs\\document.pdf', ext: 'pdf', caption: '' }
  ]

  it('returns null if files array is empty', () => {
    const { container } = render(
      <MultiFilePreview
        files={[]}
        selectedIndex={0}
        onSelectFile={vi.fn()}
        onRemoveFile={vi.fn()}
        onAddMore={vi.fn()}
        onCaptionChange={vi.fn()}
        onSend={vi.fn()}
        onClose={vi.fn()}
        sending={false}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders large preview for selected image file, thumbnail list, and caption input', () => {
    const handleCaptionChange = vi.fn()
    const handleSend = vi.fn()

    render(
      <MultiFilePreview
        files={sampleFiles}
        selectedIndex={0}
        onSelectFile={vi.fn()}
        onRemoveFile={vi.fn()}
        onAddMore={vi.fn()}
        onCaptionChange={handleCaptionChange}
        onSend={handleSend}
        onClose={vi.fn()}
        sending={false}
      />
    )

    expect(screen.getByText('Preview attachments (2)')).toBeInTheDocument()

    const img = screen.getAllByRole('img', { name: 'photo.jpg' })[0]
    expect(img).toBeInTheDocument()

    const captionInput = screen.getByPlaceholderText('Add a caption for photo.jpg...') as HTMLInputElement
    expect(captionInput.value).toBe('My photo')

    fireEvent.change(captionInput, { target: { value: 'Updated caption' } })
    expect(handleCaptionChange).toHaveBeenCalledWith(0, 'Updated caption')

    const sendBtn = screen.getByTitle('Send all')
    fireEvent.click(sendBtn)
    expect(handleSend).toHaveBeenCalledTimes(1)
  })

  it('allows removing a file from thumbnail tray', () => {
    const handleRemoveFile = vi.fn()
    const { container } = render(
      <MultiFilePreview
        files={sampleFiles}
        selectedIndex={0}
        onSelectFile={vi.fn()}
        onRemoveFile={handleRemoveFile}
        onAddMore={vi.fn()}
        onCaptionChange={vi.fn()}
        onSend={vi.fn()}
        onClose={vi.fn()}
        sending={false}
      />
    )

    const removeBtns = container.querySelectorAll('.mfp-thumb-remove')
    expect(removeBtns).toHaveLength(2)

    fireEvent.click(removeBtns[1])
    expect(handleRemoveFile).toHaveBeenCalledWith(1)
  })

  describe('@mention menu in the caption', () => {
    const Harness = ({ onMention }: { onMention: (i: number, jid: string) => void }): JSX.Element => {
      const [files, setFiles] = useState<StagedFile[]>([
        { name: 'photo.jpg', path: 'C:/images/photo.jpg', ext: 'jpg', caption: '' }
      ])
      return (
        <MultiFilePreview
          files={files}
          selectedIndex={0}
          activeJid="g1@g.us"
          onSelectFile={vi.fn()}
          onRemoveFile={vi.fn()}
          onAddMore={vi.fn()}
          onCaptionChange={(i, caption) => setFiles((f) => f.map((x, j) => (j === i ? { ...x, caption } : x)))}
          onMentionAdd={onMention}
          onSend={vi.fn()}
          onClose={vi.fn()}
          sending={false}
        />
      )
    }

    it('shows participants after typing @ and inserts @number + records the mention on select', async () => {
      const apiService = createMockApiService()
      apiService.getGroupParticipants = vi.fn().mockResolvedValue([
        { jid: '111@s.whatsapp.net', name: 'Bob', isAdmin: false, isMe: false }
      ])
      const onMention = vi.fn()
      renderWithProviders(<Harness onMention={onMention} />, { apiService })
      await waitFor(() => expect(apiService.getGroupParticipants).toHaveBeenCalledWith('g1@g.us'))

      const input = screen.getByPlaceholderText('Add a caption for photo.jpg...') as HTMLInputElement
      input.focus()
      fireEvent.change(input, { target: { value: 'hi @bo', selectionStart: 6 } })
      input.setSelectionRange(6, 6)
      fireEvent.change(input, { target: { value: 'hi @bo' } })

      fireEvent.click(await screen.findByText('Bob'))

      expect(onMention).toHaveBeenCalledWith(0, '111@s.whatsapp.net')
      expect((screen.getByPlaceholderText('Add a caption for photo.jpg...') as HTMLInputElement).value).toBe('hi @111 ')
    })

    it('does not fetch participants or show a menu when no chat jid is given', () => {
      render(
        <MultiFilePreview
          files={sampleFiles}
          selectedIndex={0}
          onSelectFile={vi.fn()}
          onRemoveFile={vi.fn()}
          onAddMore={vi.fn()}
          onCaptionChange={vi.fn()}
          onSend={vi.fn()}
          onClose={vi.fn()}
          sending={false}
        />
      )
      expect(document.querySelector('.mention-menu')).toBeNull()
    })
  })
})
