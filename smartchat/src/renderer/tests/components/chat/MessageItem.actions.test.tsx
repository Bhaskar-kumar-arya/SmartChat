/**
 * N-08 characterization of MessageItem actions (R-UICHAT-06 safety net):
 * reply, edit, delete, download, quote click, reactions, info, sticker favourite
 * and plugin message-actions, all through the real dropdown UI.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent, makeMessage } from '../../testUtils'
import MessageItem from '@renderer/components/chat/MessageItem'
import { createMockApiService, type MockApiService } from '../../mocks/mockApiService'
import type { MessageItem as IMessageItem } from '@renderer/types/chatTypes'
import type { ContributionRegistrySnapshot } from '@renderer/types/contribution.types'

const CHAT = 'chat@s.whatsapp.net'

describe('MessageItem actions', () => {
  let api: MockApiService
  let handlers: {
    onReply: Mock<(msg: IMessageItem) => void>
    onEdit: Mock<(id: string, text: string) => Promise<void>>
    onDelete: Mock<(id: string) => Promise<void>>
    onDownloadMedia: Mock<(id: string) => Promise<void>>
    onViewReactions: Mock<(msg: IMessageItem) => void>
    onScrollToMessage: Mock<(id: string) => void>
  }

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    api = createMockApiService()
    handlers = {
      onReply: vi.fn<(msg: IMessageItem) => void>(),
      onEdit: vi.fn<(id: string, text: string) => Promise<void>>().mockResolvedValue(undefined),
      onDelete: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
      onDownloadMedia: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
      onViewReactions: vi.fn<(msg: IMessageItem) => void>(),
      onScrollToMessage: vi.fn<(id: string) => void>(),
    }
  })

  const mine = (over: Partial<IMessageItem> = {}): IMessageItem =>
    makeMessage({ id: 'mine1', chatJid: CHAT, fromMe: true, textContent: 'my text', ...over })
  const theirs = (over: Partial<IMessageItem> = {}): IMessageItem =>
    makeMessage({ id: 'their1', chatJid: CHAT, fromMe: false, participant: 'them@s.whatsapp.net', textContent: 'their text', ...over })

  const renderItem = (msg: IMessageItem): ReturnType<typeof renderWithProviders> =>
    renderWithProviders(<MessageItem msg={msg} {...handlers} />, { apiService: api })

  const openMenu = (): void => {
    fireEvent.click(screen.getByTitle('Message Options'))
  }

  const menuLabels = (): string[] =>
    Array.from(document.querySelectorAll('.dropdown-menu .dropdown-item')).map((e) => e.textContent?.trim() ?? '')

  describe('dropdown', () => {
    it('is closed by default, toggles on the options button, and closes on an outside mousedown', () => {
      renderItem(theirs())
      expect(document.querySelector('.dropdown-menu')).toBeNull()
      openMenu()
      expect(document.querySelector('.dropdown-menu')).not.toBeNull()
      fireEvent.mouseDown(document.body)
      expect(document.querySelector('.dropdown-menu')).toBeNull()
      openMenu()
      openMenu()
      expect(document.querySelector('.dropdown-menu')).toBeNull()
    })

    it("offers only Reply on someone else's text message", () => {
      renderItem(theirs())
      openMenu()
      expect(menuLabels()).toEqual(['Reply'])
    })

    it('offers Reply, Info, Edit, Delete on my text message', () => {
      renderItem(mine())
      openMenu()
      expect(menuLabels()).toEqual(['Reply', 'Info', 'Edit', 'Delete'])
    })

    it('my non-text message cannot be edited; a deleted message can be neither edited nor deleted', () => {
      const { unmount } = renderItem(mine({ messageType: 'imageMessage', textContent: '' }))
      openMenu()
      expect(menuLabels()).toEqual(['Reply', 'Info', 'Delete'])
      unmount()
      renderItem(mine({ isDeleted: true }))
      openMenu()
      expect(menuLabels()).toEqual(['Reply', 'Info'])
    })
  })

  describe('reply', () => {
    it('calls onReply with the message and closes the menu', () => {
      const msg = theirs()
      renderItem(msg)
      openMenu()
      fireEvent.click(screen.getByText('Reply'))
      expect(handlers.onReply).toHaveBeenCalledWith(msg)
      expect(document.querySelector('.dropdown-menu')).toBeNull()
    })
  })

  describe('edit', () => {
    const startEdit = (): HTMLTextAreaElement => {
      openMenu()
      fireEvent.click(screen.getByText('Edit'))
      return document.querySelector('textarea.message-edit-input') as HTMLTextAreaElement
    }

    it('swaps the bubble body for a textarea prefilled with the text', () => {
      renderItem(mine())
      const ta = startEdit()
      expect(ta.value).toBe('my text')
      expect(document.querySelector('.dropdown-menu')).toBeNull()
    })

    it('Save sends the trimmed text through onEdit and leaves edit mode', async () => {
      renderItem(mine())
      const ta = startEdit()
      fireEvent.change(ta, { target: { value: '  changed  ' } })
      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => expect(handlers.onEdit).toHaveBeenCalledWith('mine1', 'changed'))
      await waitFor(() => expect(document.querySelector('textarea.message-edit-input')).toBeNull())
    })

    it('Enter saves; Shift+Enter does not', async () => {
      renderItem(mine())
      const ta = startEdit()
      fireEvent.change(ta, { target: { value: 'v2' } })
      fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
      expect(handlers.onEdit).not.toHaveBeenCalled()
      fireEvent.keyDown(ta, { key: 'Enter' })
      await waitFor(() => expect(handlers.onEdit).toHaveBeenCalledWith('mine1', 'v2'))
    })

    it('Escape and Cancel leave edit mode without calling onEdit', () => {
      renderItem(mine())
      let ta = startEdit()
      fireEvent.keyDown(ta, { key: 'Escape' })
      expect(document.querySelector('textarea.message-edit-input')).toBeNull()
      ta = startEdit()
      fireEvent.click(screen.getByText('Cancel'))
      expect(document.querySelector('textarea.message-edit-input')).toBeNull()
      expect(handlers.onEdit).not.toHaveBeenCalled()
    })

    it.each([
      ['unchanged', 'my text'],
      ['blank', '   '],
    ])('Save with %s text does not call onEdit but still exits edit mode', async (_l, value) => {
      renderItem(mine())
      const ta = startEdit()
      fireEvent.change(ta, { target: { value } })
      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => expect(document.querySelector('textarea.message-edit-input')).toBeNull())
      expect(handlers.onEdit).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    const askDelete = (): void => {
      openMenu()
      fireEvent.click(screen.getByText('Delete'))
    }

    it('asks for confirmation, then calls onDelete', async () => {
      renderItem(mine())
      askDelete()
      expect(screen.getByText('Delete this message for everyone?')).toBeInTheDocument()
      expect(handlers.onDelete).not.toHaveBeenCalled()
      const confirm = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Delete' && !b.classList.contains('dropdown-item')
      ) as HTMLElement
      fireEvent.click(confirm)
      await waitFor(() => expect(handlers.onDelete).toHaveBeenCalledWith('mine1'))
      expect(screen.queryByText('Delete this message for everyone?')).toBeNull()
    })

    it('Cancel dismisses the confirmation without deleting', () => {
      renderItem(mine())
      askDelete()
      fireEvent.click(screen.getByText('Cancel'))
      expect(screen.queryByText('Delete this message for everyone?')).toBeNull()
      expect(handlers.onDelete).not.toHaveBeenCalled()
    })

    it('shows the deleted badge on a deleted message', () => {
      renderItem(mine({ isDeleted: true }))
      expect(screen.getByText('You deleted this message')).toBeInTheDocument()
    })
  })

  describe('download', () => {
    it('an undownloaded image exposes a download control that calls onDownloadMedia with the message id', async () => {
      renderItem(makeMessage({ id: 'img1', chatJid: CHAT, messageType: 'imageMessage', textContent: '' }))
      const btn = screen.getByRole('button', { name: /download/i })
      fireEvent.click(btn)
      await waitFor(() => expect(handlers.onDownloadMedia).toHaveBeenCalledWith('img1'))
    })
  })

  describe('quote click', () => {
    const replyMsg = (): IMessageItem =>
      theirs({
        id: 'reply1',
        content: JSON.stringify({
          extendedTextMessage: {
            text: 'the reply',
            contextInfo: {
              stanzaId: 'orig1',
              participant: 'them@s.whatsapp.net',
              quotedMessage: { conversation: 'quoted body' },
            },
          },
        }),
      })

    it('renders the quoted text', () => {
      renderItem(replyMsg())
      expect(document.querySelector('.message-quote')).not.toBeNull()
      expect(screen.getByText('quoted body')).toBeInTheDocument()
    })

    it('asks the parent to scroll when the quoted message is not in the DOM', () => {
      renderItem(replyMsg())
      fireEvent.click(document.querySelector('.message-quote') as HTMLElement)
      expect(handlers.onScrollToMessage).toHaveBeenCalledWith('orig1')
    })

    it('scrolls to and pulses the quoted element when it is already rendered', () => {
      vi.useFakeTimers()
      try {
        const target = document.createElement('div')
        target.id = 'msg-orig1'
        target.scrollIntoView = vi.fn()
        document.body.appendChild(target)
        renderItem(replyMsg())
        fireEvent.click(document.querySelector('.message-quote') as HTMLElement)
        expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
        expect(target.classList.contains('highlight-pulse')).toBe(true)
        expect(handlers.onScrollToMessage).not.toHaveBeenCalled()
        vi.advanceTimersByTime(2000)
        expect(target.classList.contains('highlight-pulse')).toBe(false)
        target.remove()
      } finally {
        vi.useRealTimers()
      }
    })

    it('a quote without a stanzaId is inert', () => {
      renderItem(
        theirs({
          content: JSON.stringify({
            extendedTextMessage: { contextInfo: { quotedMessage: { conversation: 'x' } } },
          }),
        })
      )
      fireEvent.click(document.querySelector('.message-quote') as HTMLElement)
      expect(handlers.onScrollToMessage).not.toHaveBeenCalled()
    })

    it('labels a quote of my own message as "You" (participant matches my JID)', async () => {
      api.getMyJid = vi.fn().mockResolvedValue('me@s.whatsapp.net')
      renderItem(
        theirs({
          content: JSON.stringify({
            extendedTextMessage: {
              contextInfo: { stanzaId: 's', participant: 'me:5@s.whatsapp.net', quotedMessage: { conversation: 'mine' } },
            },
          }),
        })
      )
      await waitFor(() => expect(screen.getByText('You')).toBeInTheDocument())
    })
  })

  describe('reactions', () => {
    it('picking a quick reaction sends it for this chat/message and closes the bar', async () => {
      renderItem(theirs())
      fireEvent.click(screen.getByTitle('React to Message'))
      fireEvent.click(document.querySelectorAll('.quick-reaction-btn')[1] as HTMLElement)
      await waitFor(() => expect(api.reactMessage).toHaveBeenCalledWith(CHAT, 'their1', '❤️'))
      expect(document.querySelector('.quick-reaction-bar')).toBeNull()
    })

    it('a different emoji than my existing reaction replaces it instead of clearing', async () => {
      api.getMyJid = vi.fn().mockResolvedValue('me@s.whatsapp.net')
      renderItem(
        theirs({ reactions: [{ text: '👍', senderId: 'me@s.whatsapp.net', senderName: 'x', timestamp: '1' }] })
      )
      await waitFor(() => expect(api.getMyJid).toHaveBeenCalled())
      fireEvent.click(screen.getByTitle('React to Message'))
      fireEvent.click(document.querySelectorAll('.quick-reaction-btn')[1] as HTMLElement)
      await waitFor(() => expect(api.reactMessage).toHaveBeenCalledWith(CHAT, 'their1', '❤️'))
    })

    it('a "Me" sender name is treated as mine even before getMyJid resolves', async () => {
      api.getMyJid = vi.fn().mockReturnValue(new Promise(() => {}))
      renderItem(theirs({ reactions: [{ text: '👍', senderId: 'whatever', senderName: 'Me', timestamp: '1' }] }))
      fireEvent.click(screen.getByTitle('React to Message'))
      fireEvent.click(document.querySelectorAll('.quick-reaction-btn')[0] as HTMLElement)
      await waitFor(() => expect(api.reactMessage).toHaveBeenCalledWith(CHAT, 'their1', ''))
    })
  })

  describe('message info', () => {
    it('loads receipts and opens the info modal for my message', async () => {
      api.getMessageReceipts = vi.fn().mockResolvedValue([
        { userJid: 'a@s.whatsapp.net', name: 'Alice', status: 'READ', readTimestamp: 1, deliveredTimestamp: 1 },
      ])
      renderItem(mine())
      openMenu()
      fireEvent.click(screen.getByText('Info'))
      await waitFor(() => expect(screen.getByText('Message Info')).toBeInTheDocument())
      expect(api.getMessageReceipts).toHaveBeenCalledWith('mine1')
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })
  })

  describe('sticker favourites', () => {
    const sticker = (): IMessageItem =>
      theirs({ id: 'stk1', messageType: 'stickerMessage', textContent: '', localURI: 'file:///stk.webp' })

    it('offers "Star Sticker" and adds to favourites after confirmation', async () => {
      renderItem(sticker())
      openMenu()
      await waitFor(() => expect(api.isStickerFavorite).toHaveBeenCalledWith('stk1'))
      fireEvent.click(screen.getByText('Star Sticker'))
      expect(screen.getByText('Add to Favorites')).toBeInTheDocument()
      fireEvent.click(screen.getByText('Add'))
      await waitFor(() => expect(api.addStickerToFavorites).toHaveBeenCalledWith('stk1'))
    })

    it('offers "Unstar Sticker" for a favourite and removes it after confirmation', async () => {
      api.isStickerFavorite = vi.fn().mockResolvedValue(true)
      renderItem(sticker())
      openMenu()
      await waitFor(() => expect(screen.getByText('Unstar Sticker')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Unstar Sticker'))
      expect(screen.getByText('Remove from Favorites')).toBeInTheDocument()
      fireEvent.click(screen.getByText('Remove'))
      await waitFor(() => expect(api.removeStickerFromFavorites).toHaveBeenCalledWith('stk1'))
    })

    it('non-sticker messages never query favourites or show the star item', () => {
      renderItem(theirs())
      openMenu()
      expect(api.isStickerFavorite).not.toHaveBeenCalled()
      expect(menuLabels()).not.toContain('Star Sticker')
    })
  })

  describe('plugin message-actions', () => {
    const snapshot: ContributionRegistrySnapshot = {
      'message-action': [
        { pluginId: 'com.ext.a', id: 'translate', label: 'Translate' },
        { pluginId: 'com.ext.a', id: 'mine-only', label: 'Mine Only', when: { field: 'message.fromMe', op: 'eq', value: true } },
        { pluginId: 'com.ext.b', id: 'media-only', label: 'Media Only', when: { field: 'message.isMedia', op: 'eq', value: true } },
      ],
    }

    beforeEach(() => {
      api = createMockApiService({ getContributions: vi.fn().mockResolvedValue(snapshot) })
    })

    it('lists only the actions whose `when` matches the message', async () => {
      renderItem(theirs())
      await waitFor(() => expect(api.getContributions).toHaveBeenCalled())
      openMenu()
      await waitFor(() => expect(menuLabels()).toContain('Translate'))
      expect(menuLabels()).not.toContain('Mine Only')
      expect(menuLabels()).not.toContain('Media Only')
    })

    it('shows fromMe-gated actions on my message', async () => {
      renderItem(mine())
      await waitFor(() => expect(api.getContributions).toHaveBeenCalled())
      openMenu()
      await waitFor(() => expect(menuLabels()).toContain('Mine Only'))
    })

    it('executes the contribution with chat/message context and closes the menu', async () => {
      renderItem(theirs())
      openMenu()
      await waitFor(() => expect(screen.getByText('Translate')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Translate'))
      expect(api.executeContribution).toHaveBeenCalledWith({
        slot: 'message-action',
        pluginId: 'com.ext.a',
        id: 'translate',
        context: { chatJid: CHAT, messageId: 'their1' },
      })
      expect(document.querySelector('.dropdown-menu')).toBeNull()
    })
  })
})
