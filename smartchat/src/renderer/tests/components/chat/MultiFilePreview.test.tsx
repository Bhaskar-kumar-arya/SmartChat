import { render, screen, fireEvent } from '@testing-library/react'
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
})
