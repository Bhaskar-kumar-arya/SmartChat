import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MessageInfoModal from '@renderer/components/chat/MessageInfoModal'
import { MessageReceiptInfo } from '@renderer/types/chatTypes'

describe('MessageInfoModal', () => {
  it('renders no receipts label when receipts array is empty', () => {
    render(<MessageInfoModal receipts={[]} onClose={vi.fn()} />)
    expect(screen.getByText('No delivery information available yet.')).toBeInTheDocument()
  })

  it('renders list of message receipts with READ and DELIVERED status badges', () => {
    const receipts: MessageReceiptInfo[] = [
      {
        userJid: '1234567890@s.whatsapp.net',
        name: 'Alice',
        status: 'READ',
        timestamp: '1620000000000'
      },
      {
        userJid: '9876543210@s.whatsapp.net',
        name: 'Bob',
        status: 'DELIVERED',
        timestamp: '1620000000000'
      }
    ]

    render(<MessageInfoModal receipts={receipts} onClose={vi.fn()} />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()

    expect(screen.getByText(/Read •/i)).toBeInTheDocument()
    expect(screen.getByText(/Delivered •/i)).toBeInTheDocument()
  })

  it('triggers onClose when close button or backdrop is clicked', () => {
    const handleClose = vi.fn()
    const { container } = render(<MessageInfoModal receipts={[]} onClose={handleClose} />)

    const closeBtn = screen.getByRole('button')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)

    const backdrop = container.querySelector('.info-modal-backdrop')!
    fireEvent.click(backdrop)
    expect(handleClose).toHaveBeenCalledTimes(2)
  })
})
