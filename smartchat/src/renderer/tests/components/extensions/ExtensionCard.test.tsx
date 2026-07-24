import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '../../testUtils'
import { ExtensionCard } from '@renderer/components/extensions/ExtensionCard'
import { ExtensionManifest } from '@renderer/types/extension.types'

describe('ExtensionCard', () => {
  const mockManifest: ExtensionManifest = {
    id: 'ext-1',
    name: 'Smart Translator',
    version: '1.2.0',
    description: 'Translates messages in real time',
    permissions: ['read_messages', 'send_messages'],
    dedicatedChat: {
      name: 'Translator Bot',
      avatarEmoji: '🤖',
      commands: [{ name: 'translate', description: 'Translate text' }]
    }
  }

  it('renders extension manifest info', () => {
    renderWithProviders(
      <ExtensionCard
        manifest={mockManifest}
        isLoaded={true}
        isSelected={false}
        onToggle={vi.fn()}
        onReload={vi.fn()}
        onUninstall={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('Smart Translator')).toBeInTheDocument()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
    expect(screen.getByText('Translates messages in real time')).toBeInTheDocument()
    expect(screen.getByText('read_messages')).toBeInTheDocument()
    expect(screen.getByText('send_messages')).toBeInTheDocument()
    expect(screen.getByText('/translate')).toBeInTheDocument()
  })

  it('triggers onToggle when Disable/Enable button is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    renderWithProviders(
      <ExtensionCard
        manifest={mockManifest}
        isLoaded={true}
        isSelected={false}
        onToggle={onToggle}
        onReload={vi.fn()}
        onUninstall={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    const toggleBtn = screen.getByRole('button', { name: 'Disable' })
    await user.click(toggleBtn)

    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('renders Reload and Chat buttons when loaded', async () => {
    const user = userEvent.setup()
    const onReload = vi.fn()
    const onOpenChat = vi.fn()

    renderWithProviders(
      <ExtensionCard
        manifest={mockManifest}
        isLoaded={true}
        isSelected={false}
        onToggle={vi.fn()}
        onReload={onReload}
        onUninstall={vi.fn()}
        onSelect={vi.fn()}
        onOpenChat={onOpenChat}
      />
    )

    const reloadBtn = screen.getByTitle('Reload extension')
    await user.click(reloadBtn)
    expect(onReload).toHaveBeenCalledOnce()

    const chatBtn = screen.getByTitle('Open dedicated chat')
    await user.click(chatBtn)
    expect(onOpenChat).toHaveBeenCalledOnce()
  })

  it('triggers onSelect when card container is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    renderWithProviders(
      <ExtensionCard
        manifest={mockManifest}
        isLoaded={true}
        isSelected={false}
        onToggle={vi.fn()}
        onReload={vi.fn()}
        onUninstall={vi.fn()}
        onSelect={onSelect}
      />
    )

    await user.click(screen.getByText('Smart Translator'))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
