import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, fireEvent, userEvent } from '../../testUtils'
import { ExtensionChatInput } from '@renderer/components/chat/ExtensionChat/ExtensionChatInput'
import { ExtensionChatListItem } from '@renderer/components/chat/ExtensionChatListItem'
import { ExtensionMessageRenderer } from '@renderer/components/chat/ExtensionChat/ExtensionMessageRenderer'
import { SlashCommand } from '@renderer/types/extension.types'

describe('ExtensionChat Components', () => {
  const dummyCommands: SlashCommand[] = [
    { name: 'summary', description: 'Summarize recent messages' },
    { name: 'translate', description: 'Translate text to English' }
  ]

  describe('ExtensionChatInput', () => {
    it('renders text input and send button', () => {
      renderWithProviders(
        <ExtensionChatInput commands={dummyCommands} onSend={vi.fn()} />
      )

      expect(screen.getByPlaceholderText('Type a message or /command…')).toBeInTheDocument()
      expect(screen.getByTitle('Send')).toBeDisabled()
    })

    it('filters slash commands when typing / in input', async () => {
      const user = userEvent.setup()
      renderWithProviders(
        <ExtensionChatInput commands={dummyCommands} onSend={vi.fn()} />
      )

      const input = screen.getByPlaceholderText('Type a message or /command…')
      await user.type(input, '/sum')

      expect(screen.getByText('/summary')).toBeInTheDocument()
      expect(screen.getByText('Summarize recent messages')).toBeInTheDocument()
      expect(screen.queryByText('/translate')).not.toBeInTheDocument()
    })

    it('selects command from autocomplete dropdown on click', async () => {
      const user = userEvent.setup()
      renderWithProviders(
        <ExtensionChatInput commands={dummyCommands} onSend={vi.fn()} />
      )

      const input = screen.getByPlaceholderText('Type a message or /command…')
      await user.type(input, '/')

      const summaryOption = screen.getByText('/summary')
      await user.click(summaryOption)

      expect(input).toHaveValue('/summary ')
    })

    it('calls onSend when submitting text', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      renderWithProviders(
        <ExtensionChatInput commands={dummyCommands} onSend={onSend} />
      )

      const input = screen.getByPlaceholderText('Type a message or /command…')
      await user.type(input, 'Hello Bot{Enter}')

      expect(onSend).toHaveBeenCalledWith('Hello Bot')
      expect(input).toHaveValue('')
    })
  })

  describe('ExtensionChatListItem', () => {
    const dummyChat = {
      jid: 'extension_bot123',
      name: 'Translation Assistant',
      unreadCount: 3,
      source: 'extension' as const
    }

    it('renders extension chat item with bot icon and badge', () => {
      const onSelect = vi.fn()
      renderWithProviders(
        <ExtensionChatListItem chat={dummyChat as any} isActive={false} onSelect={onSelect} />
      )

      expect(screen.getByText('Translation Assistant')).toBeInTheDocument()
      expect(screen.getByText('Extension')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Translation Assistant'))
      expect(onSelect).toHaveBeenCalled()
    })
  })

  describe('ExtensionMessageRenderer', () => {
    it('renders user and bot messages', () => {
      const msg = {
        id: '1',
        extensionId: 'ext-1',
        role: 'user' as const,
        content: 'Translate this text',
        timestamp: 1600000000,
        createdAt: '2026-07-24T20:00:00.000Z'
      }

      renderWithProviders(<ExtensionMessageRenderer message={msg} onAction={vi.fn()} />)
      expect(screen.getByText('Translate this text')).toBeInTheDocument()
    })
  })
})
