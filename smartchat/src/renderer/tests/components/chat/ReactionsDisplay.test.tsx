import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ReactionsDisplay from '@renderer/components/chat/ReactionsDisplay'

describe('ReactionsDisplay', () => {
  it('returns null when reactions is null or empty', () => {
    const { container: emptyContainer } = render(<ReactionsDisplay reactions={[]} onClick={vi.fn()} />)
    expect(emptyContainer.firstChild).toBeNull()

    const { container: undefinedContainer } = render(<ReactionsDisplay onClick={vi.fn()} />)
    expect(undefinedContainer.firstChild).toBeNull()
  })

  it('renders mini reaction bubbles and total reaction count', () => {
    const handleClick = vi.fn()
    const reactions = [
      { senderId: 'user1@s.whatsapp.net', text: '👍', timestamp: '1620000000' },
      { senderId: 'user2@s.whatsapp.net', text: '❤️', timestamp: '1620000000' },
      { senderId: 'user3@s.whatsapp.net', text: '👍', timestamp: '1620000000' }
    ]

    const { container } = render(<ReactionsDisplay reactions={reactions} onClick={handleClick} />)

    expect(screen.getByText('3')).toBeInTheDocument()
    const miniBubbles = container.querySelectorAll('.reaction-bubble-mini')
    expect(miniBubbles.length).toBe(2) // 2 unique emojis (👍, ❤️)

    fireEvent.click(container.querySelector('.message-reactions')!)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
