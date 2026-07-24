import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, userEvent } from '../../testUtils'
import MessageInput from '@renderer/components/chat/MessageInput'
import { MessageItem } from '@renderer/types/chatTypes'

describe('MessageInput', () => {
  const defaultProps = {
    activeJid: '123456789@s.whatsapp.net',
    onSend: vi.fn(),
    onSendMedia: vi.fn(),
    replyingTo: null,
    onCancelReply: vi.fn(),
    onAttachFiles: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders contenteditable input area and action buttons', () => {
    renderWithProviders(<MessageInput {...defaultProps} />)

    expect(screen.getByTitle('Attach file')).toBeInTheDocument()
    expect(screen.getByTitle('Emojis, Stickers, GIFs')).toBeInTheDocument()
    expect(screen.getByTitle('Record voice message')).toBeInTheDocument()
  })

  it('allows typing text into message editor and sending via Send button', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    renderWithProviders(<MessageInput {...defaultProps} onSend={onSend} />)

    const editor = document.querySelector('.message-input') as HTMLElement
    expect(editor).toBeInTheDocument()

    fireEvent.input(editor, { target: { textContent: 'Hello world' } })

    const sendBtn = screen.getByTitle('Send message')
    expect(sendBtn).toBeInTheDocument()
    await user.click(sendBtn)

    expect(onSend).toHaveBeenCalledWith('Hello world', [])
  })

  it('sends message on Enter key press without Shift key', async () => {
    const onSend = vi.fn()
    renderWithProviders(<MessageInput {...defaultProps} onSend={onSend} />)

    const editor = document.querySelector('.message-input') as HTMLElement
    fireEvent.input(editor, { target: { textContent: 'Quick message' } })

    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: false })

    expect(onSend).toHaveBeenCalledWith('Quick message', [])
  })

  it('does NOT send message when Shift+Enter is pressed', async () => {
    const onSend = vi.fn()
    renderWithProviders(<MessageInput {...defaultProps} onSend={onSend} />)

    const editor = document.querySelector('.message-input') as HTMLElement
    fireEvent.input(editor, { target: { textContent: 'Multi-line message' } })

    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('renders reply preview header when replyingTo prop is provided', async () => {
    const user = userEvent.setup()
    const onCancelReply = vi.fn()
    const replyMessage: MessageItem = {
      id: 'msg-1',
      chatJid: '123456789@s.whatsapp.net',
      fromMe: false,
      participant: null,
      messageType: 'conversation',
      timestamp: '1600000000',
      status: 'READ',
      textContent: 'Original message to reply to',
      participantName: 'Alice'
    }

    renderWithProviders(
      <MessageInput {...defaultProps} replyingTo={replyMessage} onCancelReply={onCancelReply} />
    )

    expect(screen.getByText(/Replying to/i)).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Original message to reply to')).toBeInTheDocument()

    const closeBtn = document.querySelector('.reply-preview-close') as HTMLElement
    expect(closeBtn).toBeInTheDocument()
    await user.click(closeBtn)

    expect(onCancelReply).toHaveBeenCalled()
  })

  it('toggles emoji picker popover when emoji button is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MessageInput {...defaultProps} />)

    const emojiBtn = screen.getByTitle('Emojis, Stickers, GIFs')
    expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument()

    await user.click(emojiBtn)
    expect(document.querySelector('.picker-popover-container')).toBeInTheDocument()
  })

  it('triggers file selection when attach button is clicked', async () => {
    const user = userEvent.setup()
    const onAttachFiles = vi.fn()
    const { apiService } = renderWithProviders(
      <MessageInput {...defaultProps} onAttachFiles={onAttachFiles} />
    )
    apiService.selectFile = vi.fn().mockResolvedValue(['/path/to/file1.png', '/path/to/file2.pdf'])

    const attachBtn = screen.getByTitle('Attach file')
    await user.click(attachBtn)

    expect(apiService.selectFile).toHaveBeenCalled()
    expect(onAttachFiles).toHaveBeenCalledWith(['/path/to/file1.png', '/path/to/file2.pdf'])
  })
})
