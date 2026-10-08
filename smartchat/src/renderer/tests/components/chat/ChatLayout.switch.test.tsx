import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, act } from '../../testUtils'
import { createMockApiService } from '../../mocks/mockApiService'
import ChatLayout from '@renderer/components/chat/ChatLayout'

interface ChatListStubProps {
  onSelectChat: (jid: string, name: string, pic?: string | null, messageId?: string | null) => void
  onOpenExtensionChat?: (extensionId: string, name: string) => void
}

// Real ChatList is covered elsewhere; this stub only drives the callbacks ChatLayout hands it.
vi.mock('@renderer/components/chat/ChatList', () => ({
  default: ({ onSelectChat, onOpenExtensionChat }: ChatListStubProps) => (
    <div>
      <button onClick={() => onSelectChat('a@s.whatsapp.net', 'Chat A')}>select-A</button>
      <button onClick={() => onSelectChat('b@s.whatsapp.net', 'Chat B')}>select-B</button>
      <button onClick={() => onSelectChat('a@s.whatsapp.net', 'Chat A', null, 'msg-42')}>hit-in-A</button>
      <button onClick={() => onOpenExtensionChat?.('bot', 'Bot')}>open-ext</button>
    </div>
  )
}))

vi.mock('@renderer/components/chat/ExtensionChat/ExtensionChatView', () => ({
  ExtensionChatView: () => <div>extension-chat-view</div>
}))

const A = 'a@s.whatsapp.net'

function settle(): Promise<void> {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
}

describe('ChatLayout chat-switch hygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
  })

  async function openA(): Promise<ReturnType<typeof createMockApiService>> {
    const api = createMockApiService()
    renderWithProviders(<ChatLayout />, { apiService: api })
    await settle()
    fireEvent.click(screen.getByText('select-A'))
    await settle()
    return api
  }

  function dropFile(path: string): void {
    const file = Object.assign(new File(['x'], 'pic.png', { type: 'image/png' }), { path })
    const main = document.querySelector('.chat-main') as HTMLElement
    fireEvent.drop(main, { dataTransfer: { files: { 0: file, length: 1, item: () => file } } })
  }

  it.fails('B-UICHAT-03: switching chats discards staged attachments', async () => {
    await openA()
    dropFile('/tmp/pic.png')
    await settle()
    expect(screen.getByText('Preview attachments (1)')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select-B'))
    await settle()

    expect(screen.queryByText(/Preview attachments/)).not.toBeInTheDocument()
  })

  it('B-UICHAT-03: re-selecting the same chat keeps staged attachments', async () => {
    await openA()
    dropFile('/tmp/pic.png')
    await settle()

    fireEvent.click(screen.getByText('select-A'))
    await settle()

    expect(screen.getByText('Preview attachments (1)')).toBeInTheDocument()
  })

  it.fails('B-UICHAT-05: a search hit in the already-open chat fetches the target window', async () => {
    const api = await openA()
    expect(api.getMessagesAround).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('hit-in-A'))
    await settle()

    expect(api.getMessagesAround).toHaveBeenCalledWith(A, 'msg-42')
  })

  it.fails('B-UICHAT-12: opening an extension chat never feeds the synthetic jid to message APIs', async () => {
    const api = await openA()
    vi.mocked(api.getMessages).mockClear()
    vi.mocked(api.markRead).mockClear()
    vi.mocked(api.setActiveChat).mockClear()

    fireEvent.click(screen.getByText('open-ext'))
    await settle()

    expect(screen.getByText('extension-chat-view')).toBeInTheDocument()
    expect(api.getMessages).not.toHaveBeenCalledWith('extension_bot', expect.anything())
    expect(api.markRead).not.toHaveBeenCalledWith('extension_bot')
    expect(api.setActiveChat).not.toHaveBeenCalledWith('extension_bot')
  })

  it('B-UICHAT-12: the extension: prefix from onOpenChat opens the extension chat', async () => {
    const api = createMockApiService()
    renderWithProviders(<ChatLayout />, { apiService: api })
    await settle()

    api.emit.openChat({ jid: 'extension:bot', name: 'Bot' })
    await settle()
    expect(screen.getByText('extension-chat-view')).toBeInTheDocument()
  })
})
