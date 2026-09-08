import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ConfirmModal from '@renderer/components/common/ConfirmModal'

describe('ConfirmModal', () => {
  it('returns null when isOpen is false', () => {
    const { container } = render(
      <ConfirmModal
        isOpen={false}
        title="Delete Chat"
        description="Are you sure?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders title, description, and action buttons when open', () => {
    const handleConfirm = vi.fn()
    const handleCancel = vi.fn()

    render(
      <ConfirmModal
        isOpen={true}
        title="Delete Chat"
        description="Are you sure you want to delete this chat?"
        confirmLabel="Yes, Delete"
        cancelLabel="No, Cancel"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        isDanger={true}
      />
    )

    expect(screen.getByText('Delete Chat')).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to delete this chat?')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: 'Yes, Delete' })
    const cancelBtn = screen.getByRole('button', { name: 'No, Cancel' })

    expect(confirmBtn).toHaveClass('delete')
    expect(cancelBtn).toHaveClass('cancel')

    fireEvent.click(confirmBtn)
    expect(handleConfirm).toHaveBeenCalledTimes(1)

    fireEvent.click(cancelBtn)
    expect(handleCancel).toHaveBeenCalledTimes(1)
  })

  it('triggers onCancel when backdrop overlay is clicked', () => {
    const handleCancel = vi.fn()
    render(
      <ConfirmModal
        isOpen={true}
        title="Title"
        description="Desc"
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />
    )

    const overlay = document.querySelector('.modal-overlay')!
    fireEvent.click(overlay)
    expect(handleCancel).toHaveBeenCalledTimes(1)
  })
})
