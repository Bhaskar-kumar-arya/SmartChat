import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EmojiText } from '@renderer/components/common/EmojiText'

describe('EmojiText', () => {
  it('returns null when text is undefined or empty', () => {
    const { container: emptyContainer } = render(<EmojiText text="" />)
    expect(emptyContainer.firstChild).toBeNull()

    const { container: undefinedContainer } = render(<EmojiText />)
    expect(undefinedContainer.firstChild).toBeNull()
  })

  it('renders plain text without emojis', () => {
    const { container } = render(<EmojiText text="Hello World" />)
    expect(container.textContent).toBe('Hello World')
    expect(container.querySelectorAll('.emoji-inline-wrapper')).toHaveLength(0)
  })

  it('parses and replaces emojis with Emoji components', () => {
    const { container } = render(<EmojiText text="Hello 👋 World 🌍" />)
    expect(container.querySelectorAll('.emoji-inline-wrapper')).toHaveLength(2)
    expect(container.textContent).toContain('Hello')
    expect(container.textContent).toContain('World')
  })

  it('applies className and style props to container', () => {
    const { container } = render(
      <EmojiText text="Test" className="custom-emoji-text" style={{ color: 'red' }} />
    )
    const span = container.querySelector('.custom-emoji-text')
    expect(span).toBeInTheDocument()
    expect(span).toHaveStyle({ color: 'rgb(255, 0, 0)' })
  })
})
