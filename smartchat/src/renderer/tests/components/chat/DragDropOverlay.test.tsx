import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import DragDropOverlay from '@renderer/components/chat/DragDropOverlay'

describe('DragDropOverlay', () => {
  it('returns null when isVisible is false', () => {
    const { container } = render(<DragDropOverlay isVisible={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders drop overlay instructions when isVisible is true', () => {
    render(<DragDropOverlay isVisible={true} />)
    expect(screen.getByText('Drop files here')).toBeInTheDocument()
    expect(screen.getByText('Add them as attachments to your messages')).toBeInTheDocument()
  })
})
