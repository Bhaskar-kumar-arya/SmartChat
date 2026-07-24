import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import AISmartInput from '@renderer/components/ai/AISmartInput'

describe('AISmartInput', () => {
  it('renders textarea with placeholder', () => {
    renderWithProviders(
      <AISmartInput
        chatList={[]}
        onSend={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText(/Ask AI… \(@ to mention\)/i)
    expect(textarea).toBeInTheDocument()
  })

  it('disables send button when input is empty', () => {
    renderWithProviders(
      <AISmartInput
        chatList={[]}
        onSend={vi.fn()}
      />
    )

    const sendBtn = screen.getByRole('button')
    expect(sendBtn).toBeDisabled()
  })

  it('triggers onSend on button click when input has text', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    renderWithProviders(
      <AISmartInput
        chatList={[]}
        onSend={onSend}
      />
    )

    const textarea = screen.getByPlaceholderText(/Ask AI…/i)
    await user.type(textarea, 'Hello AI')

    const sendBtn = screen.getByRole('button')
    expect(sendBtn).not.toBeDisabled()

    await user.click(sendBtn)
    expect(onSend).toHaveBeenCalledWith('Hello AI', [])
    expect(textarea).toHaveValue('')
  })

  it('triggers onSend when Enter is pressed without Shift', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    renderWithProviders(
      <AISmartInput
        chatList={[]}
        onSend={onSend}
      />
    )

    const textarea = screen.getByPlaceholderText(/Ask AI…/i)
    await user.type(textarea, 'Prompt with enter{Enter}')

    expect(onSend).toHaveBeenCalledWith('Prompt with enter', [])
  })

  it('renders abort button when disabled and onAbort is provided', async () => {
    const user = userEvent.setup()
    const onAbort = vi.fn()

    renderWithProviders(
      <AISmartInput
        chatList={[]}
        onSend={vi.fn()}
        disabled={true}
        onAbort={onAbort}
      />
    )

    const abortBtn = screen.getByTitle('Stop Generation')
    await user.click(abortBtn)

    expect(onAbort).toHaveBeenCalledOnce()
  })

  it('renders mention context chip when externalValue includes mentions', () => {
    renderWithProviders(
      <AISmartInput
        chatList={[]}
        onSend={vi.fn()}
        externalValue={{
          prompt: 'Hi @Alice',
          mentions: [{ jid: 'alice@s.whatsapp.net', name: 'Alice' }]
        }}
      />
    )

    expect(screen.getAllByText(/@Alice/i).length).toBeGreaterThan(0)
  })
})
