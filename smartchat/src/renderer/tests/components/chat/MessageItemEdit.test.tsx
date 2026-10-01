import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../testUtils'
import MessageItem from '@renderer/components/chat/MessageItem'
import { MessageItem as IMessageItem } from '@renderer/types/chatTypes'

// Pin-phase only: today the failure escapes as an unhandled rejection (the bug).
// Swallow it so the it.fails pins keep the run free of unhandled errors.
const swallowUnhandledRejections = () => {
  const original = process.emit.bind(process) as (event: string, ...args: unknown[]) => boolean
  vi.spyOn(process, 'emit').mockImplementation(((event: string, ...args: unknown[]) =>
    event === 'unhandledRejection' ? true : original(event, ...args)) as typeof process.emit)
}

describe('MessageItem — edit/delete failures and edit draft (B-UICHAT-10, B-UICHAT-13)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    swallowUnhandledRejections()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mine: IMessageItem = {
    id: 'm1',
    chatJid: 'user1@s.whatsapp.net',
    participant: null,
    fromMe: true,
    timestamp: '1600000000',
    status: 'READ',
    messageType: 'conversation',
    textContent: 'original'
  }

  const openMenuItem = (label: string) => {
    fireEvent.click(screen.getByTitle('Message Options'))
    fireEvent.click(screen.getByText(label))
  }

  it.fails('shows a toast and keeps the editor open when saving an edit fails (B-UICHAT-10)', async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error('edit exploded'))
    renderWithProviders(<MessageItem msg={mine} onReply={vi.fn()} onViewReactions={vi.fn()} onEdit={onEdit} />)

    openMenuItem('Edit')
    const textarea = document.querySelector('.message-edit-input') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'changed' } })
    fireEvent.click(document.querySelector('.edit-btn-save') as HTMLElement)

    expect(await screen.findByRole('alert')).toHaveTextContent('edit exploded')
    expect(document.querySelector('.message-edit-input')).toBeInTheDocument()
  })

  it.fails('shows a toast when deleting a message fails (B-UICHAT-10)', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('delete exploded'))
    renderWithProviders(<MessageItem msg={mine} onReply={vi.fn()} onViewReactions={vi.fn()} onDelete={onDelete} />)

    openMenuItem('Delete')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('delete exploded')
  })

  it.fails('re-seeds the edit draft from the message text on each open (B-UICHAT-13)', () => {
    const { rerender } = renderWithProviders(
      <MessageItem msg={mine} onReply={vi.fn()} onViewReactions={vi.fn()} onEdit={vi.fn()} />
    )

    openMenuItem('Edit')
    const textarea = document.querySelector('.message-edit-input') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'discarded draft' } })
    fireEvent.click(document.querySelector('.edit-btn-cancel') as HTMLElement)

    rerender(
      <MessageItem
        msg={{ ...mine, textContent: 'remotely edited' }}
        onReply={vi.fn()}
        onViewReactions={vi.fn()}
        onEdit={vi.fn()}
      />
    )
    openMenuItem('Edit')

    expect((document.querySelector('.message-edit-input') as HTMLTextAreaElement).value).toBe('remotely edited')
  })
})
