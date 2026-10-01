import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, userEvent, waitFor } from '../../testUtils'
import { createMockApiService } from '../../mocks/mockApiService'
import MessageInput from '@renderer/components/chat/MessageInput'
import { MessageItem } from '@renderer/types/chatTypes'

const mockRecorder = {
  isRecording: false,
  duration: 0,
  audioBlob: null as Blob | null,
  visualizerData: [] as number[],
  isPlayingPreview: false,
  startRecording: vi.fn().mockResolvedValue(undefined),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  togglePreviewPlayback: vi.fn(),
  stopPreview: vi.fn(),
}

vi.mock('@renderer/hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => mockRecorder,
}))

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
    mockRecorder.isRecording = false
    mockRecorder.audioBlob = null
    mockRecorder.startRecording.mockResolvedValue(undefined)
  })

  describe('voice note chat-switch safety (F6-01)', () => {
    it('cancels an in-progress recording when the active chat changes', () => {
      mockRecorder.isRecording = true
      const { rerender } = renderWithProviders(
        <MessageInput {...defaultProps} activeJid="A@s.whatsapp.net" />
      )
      mockRecorder.cancelRecording.mockClear()

      rerender(<MessageInput {...defaultProps} activeJid="B@s.whatsapp.net" />)

      expect(mockRecorder.cancelRecording).toHaveBeenCalled()
    })

    it('does not deliver a staged voice note to a chat switched to mid-recording', async () => {
      const user = userEvent.setup()
      const onSendMedia = vi.fn()
      const { rerender } = renderWithProviders(
        <MessageInput {...defaultProps} activeJid="A@s.whatsapp.net" onSendMedia={onSendMedia} />
      )

      // Start recording in chat A
      await user.click(screen.getByTitle('Record voice message'))
      expect(mockRecorder.startRecording).toHaveBeenCalled()

      // A blob gets staged (waiting for the send / trash choice)
      mockRecorder.audioBlob = new Blob(['audio'])
      rerender(<MessageInput {...defaultProps} activeJid="A@s.whatsapp.net" onSendMedia={onSendMedia} />)

      // User switches to chat B while the blob is staged
      rerender(<MessageInput {...defaultProps} activeJid="B@s.whatsapp.net" onSendMedia={onSendMedia} />)

      // Pressing send must NOT deliver the note to chat B
      const sendVoiceBtn = document.querySelector('.recording-action-btn.success') as HTMLElement
      expect(sendVoiceBtn).toBeInTheDocument()
      await user.click(sendVoiceBtn)

      expect(onSendMedia).not.toHaveBeenCalled()
    })
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

  describe('send failure feedback (B-UICHAT-10)', () => {
    it('shows a toast and keeps the draft when onSend rejects', async () => {
      const onSend = vi.fn().mockRejectedValue(new Error('send exploded'))
      renderWithProviders(<MessageInput {...defaultProps} onSend={onSend} />)
      const editor = document.querySelector('.message-input') as HTMLElement
      fireEvent.input(editor, { target: { textContent: 'keep me' } })

      fireEvent.keyDown(editor, { key: 'Enter', shiftKey: false })

      expect(await screen.findByRole('alert')).toHaveTextContent('send exploded')
      expect(editor.textContent).toBe('keep me')
    })
  })

  describe('Enter with an open @ token (B-UICHAT-04)', () => {
    const typeWithCaretAtEnd = (editor: HTMLElement, value: string) => {
      editor.textContent = value
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      fireEvent.input(editor)
    }

    it('sends on Enter in a DM even though the text contains an @ token', () => {
      const onSend = vi.fn()
      renderWithProviders(<MessageInput {...defaultProps} onSend={onSend} />)
      const editor = document.querySelector('.message-input') as HTMLElement

      typeWithCaretAtEnd(editor, 'mail me at bob@corp.com')
      fireEvent.keyDown(editor, { key: 'Enter', shiftKey: false })

      expect(onSend).toHaveBeenCalledWith('mail me at bob@corp.com', [])
    })

    it('does not send on Enter while a visible mention menu is open in a group', async () => {
      const onSend = vi.fn()
      const apiService = createMockApiService()
      apiService.getGroupParticipants = vi.fn().mockResolvedValue([
        { jid: '111@s.whatsapp.net', name: 'Bob', isAdmin: false, isMe: false }
      ])
      renderWithProviders(
        <MessageInput {...defaultProps} activeJid="g1@g.us" onSend={onSend} />,
        { apiService }
      )
      const editor = document.querySelector('.message-input') as HTMLElement
      await waitFor(() => expect(apiService.getGroupParticipants).toHaveBeenCalled())

      typeWithCaretAtEnd(editor, 'hi @bo')
      await screen.findByText('Bob')
      fireEvent.keyDown(editor, { key: 'Enter', shiftKey: false })

      expect(onSend).not.toHaveBeenCalled()
    })
  })
})
