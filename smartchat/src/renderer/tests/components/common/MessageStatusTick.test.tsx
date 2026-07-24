import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MessageStatusTick } from '@renderer/components/common/MessageStatusTick'

describe('MessageStatusTick', () => {
  it('renders PENDING clock icon for PENDING status', () => {
    render(<MessageStatusTick status="PENDING" />)
    const tick = screen.getByTitle('Pending')
    expect(tick).toBeInTheDocument()
    expect(tick.querySelector('.status-clock')).toBeInTheDocument()
  })

  it('renders DELIVERED double check icon for DELIVERED status', () => {
    render(<MessageStatusTick status="DELIVERED" />)
    const tick = screen.getByTitle('Delivered')
    expect(tick).toBeInTheDocument()
    expect(tick.querySelector('.status-delivered')).toBeInTheDocument()
  })

  it('renders READ blue double check icon for READ status', () => {
    render(<MessageStatusTick status="READ" />)
    const tick = screen.getByTitle('Read')
    expect(tick).toBeInTheDocument()
    expect(tick.querySelector('.status-read')).toBeInTheDocument()
  })

  it('renders READ blue double check icon for PLAYED status', () => {
    render(<MessageStatusTick status="PLAYED" />)
    const tick = screen.getByTitle('Read')
    expect(tick).toBeInTheDocument()
    expect(tick.querySelector('.status-read')).toBeInTheDocument()
  })

  it('renders default SENT icon when status is SENT or undefined', () => {
    const { rerender } = render(<MessageStatusTick status="SENT" />)
    expect(screen.getByTitle('Sent')).toBeInTheDocument()

    rerender(<MessageStatusTick />)
    expect(screen.getByTitle('Sent')).toBeInTheDocument()
  })

  it('handles lowercase status strings appropriately (e.g. read, delivered, pending)', () => {
    const { rerender } = render(<MessageStatusTick status="read" />)
    expect(screen.getByTitle('Read')).toBeInTheDocument()

    rerender(<MessageStatusTick status="delivered" />)
    expect(screen.getByTitle('Delivered')).toBeInTheDocument()

    rerender(<MessageStatusTick status="pending" />)
    expect(screen.getByTitle('Pending')).toBeInTheDocument()
  })

  it('applies custom className and style props', () => {
    render(<MessageStatusTick status="SENT" className="my-custom-tick" style={{ margin: '10px' }} />)
    const tick = screen.getByTitle('Sent')
    expect(tick).toHaveClass('msg-status-tick', 'my-custom-tick')
    expect(tick).toHaveStyle({ margin: '10px' })
  })
})
