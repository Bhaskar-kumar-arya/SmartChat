import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TextMessage } from '@renderer/components/chat/messages/TextMessage'

describe('TextMessage', () => {
  it('returns null when text is undefined or empty', () => {
    const { container: emptyContainer } = render(<TextMessage text="" />)
    expect(emptyContainer.firstChild).toBeNull()

    const { container: undefinedContainer } = render(<TextMessage text={undefined as any} />)
    expect(undefinedContainer.firstChild).toBeNull()
  })

  it('renders plain text markdown body', () => {
    render(<TextMessage text="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('converts WhatsApp bold (*text*) to markdown strong', () => {
    render(<TextMessage text="This is *important* text" />)
    const strong = screen.getByText('important')
    expect(strong.tagName).toBe('STRONG')
  })

  it('converts WhatsApp strikethrough (~text~) to markdown del', () => {
    render(<TextMessage text="This is ~old~ text" />)
    const del = screen.getByText('old')
    expect(del.tagName).toBe('DEL')
  })

  it('preserves code blocks and inline code without converting formatting', () => {
    render(<TextMessage text="`*not bold*` and ```*also not bold*```" />)
    expect(screen.getByText('*not bold*')).toBeInTheDocument()
    expect(screen.getByText('*also not bold*')).toBeInTheDocument()
  })

  it('renders mentions correctly with highlights', () => {
    render(
      <TextMessage
        text="Hello @1234567890"
        mentions={{ '1234567890@s.whatsapp.net': 'Alice' }}
      />
    )
    const mention = screen.getByText('@Alice')
    expect(mention).toBeInTheDocument()
    expect(mention).toHaveClass('message-mention')
  })

  it('neutralizes javascript: markdown links (no live href) [F5-01]', () => {
    const { container } = render(<TextMessage text="[tap](javascript:alert(1))" />)
    const a = container.querySelector('a')
    expect((a?.getAttribute('href') ?? '')).not.toMatch(/^javascript:/i)
    expect(container.textContent).toContain('tap')
  })

  it('neutralizes data: markdown links [F5-01]', () => {
    const { container } = render(
      <TextMessage text="[x](data:text/html;base64,PHNjcmlwdD4=)" />
    )
    const a = container.querySelector('a')
    expect((a?.getAttribute('href') ?? '')).not.toMatch(/^data:/i)
  })

  it('keeps safe https markdown links [F5-01]', () => {
    const { container } = render(<TextMessage text="[ok](https://example.com/path)" />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toMatch(/^https:\/\/example\.com\/path/)
  })

  it('converts emojis to Emoji components', () => {
    const { container } = render(<TextMessage text="Great job! 👍" />)
    expect(container.querySelector('.emoji-inline-wrapper')).toBeInTheDocument()
  })

  it('does not treat single $ as inline math (B-UICHAT-08)', () => {
    const { container } = render(<TextMessage text="it's $5 now and $10 later" />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.textContent).toContain("it's $5 now and $10 later")
  })

  it('does not render an e-mail address as a mention (B-UICHAT-09)', () => {
    const { container } = render(<TextMessage text="write to foo@bar.com today" />)
    expect(container.querySelector('.message-mention')).toBeNull()
    expect(container.textContent).toContain('foo@bar.com')
  })

  it('does not resolve a short @1 token to a mention by key prefix (B-UICHAT-09)', () => {
    render(<TextMessage text="see @1" mentions={{ '1234567890@s.whatsapp.net': 'Alice' }} />)
    expect(screen.queryByText('@Alice')).toBeNull()
  })
})
