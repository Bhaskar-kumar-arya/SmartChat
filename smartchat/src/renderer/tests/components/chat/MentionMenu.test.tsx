import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MentionMenu from '@renderer/components/chat/MentionMenu'

describe('MentionMenu', () => {
  const participants = [
    { jid: '12345@s.whatsapp.net', name: 'Alice', isAdmin: true, isMe: false },
    { jid: '67890@s.whatsapp.net', name: 'Bob', isAdmin: false, isMe: false },
    { jid: '99999@s.whatsapp.net', name: 'Charlie (Me)', isAdmin: false, isMe: true }
  ]

  it('returns null when query matches no participants', () => {
    const { container } = render(
      <MentionMenu
        participants={participants}
        query="nonexistent"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('filters out current user (isMe) and renders matching participants', () => {
    render(
      <MentionMenu
        participants={participants}
        query=""
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.queryByText('Charlie (Me)')).not.toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('navigates with ArrowDown / ArrowUp and selects item on Enter key', () => {
    const handleSelect = vi.fn()
    const { container } = render(
      <MentionMenu
        participants={participants}
        query=""
        onSelect={handleSelect}
        onClose={vi.fn()}
      />
    )

    // Initial selected index is 0 (Alice)
    const items = container.querySelectorAll('.mention-item')
    expect(items[0]).toHaveClass('active')

    // Press ArrowDown -> index 1 (Bob)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(items[1]).toHaveClass('active')

    // Press Enter -> selects Bob
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(handleSelect).toHaveBeenCalledWith(participants[1])
  })

  it('calls onClose on Escape key press', () => {
    const handleClose = vi.fn()
    render(
      <MentionMenu
        participants={participants}
        query=""
        onSelect={vi.fn()}
        onClose={handleClose}
      />
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('prevents default on row mousedown so the editor keeps focus/selection (F6-02)', () => {
    render(
      <MentionMenu
        participants={participants}
        query=""
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const row = screen.getByText('Bob').closest('.mention-item') as HTMLElement
    // fireEvent returns false when a cancelable event had preventDefault() called
    const notPrevented = fireEvent.mouseDown(row)
    expect(notPrevented).toBe(false)
  })

  it('does not throw on arrow keys when nothing matches the query (F6-11)', () => {
    render(
      <MentionMenu
        participants={participants}
        query="zzz-no-match"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
      fireEvent.keyDown(window, { key: 'ArrowUp' })
      fireEvent.keyDown(window, { key: 'Enter' })
    }).not.toThrow()
  })

  it('selects participant on click', () => {
    const handleSelect = vi.fn()
    render(
      <MentionMenu
        participants={participants}
        query=""
        onSelect={handleSelect}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('Bob'))
    expect(handleSelect).toHaveBeenCalledWith(participants[1])
  })
})
