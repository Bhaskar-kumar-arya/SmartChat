import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, act } from '../../testUtils'
import ChatLayout from '@renderer/components/chat/ChatLayout'

describe('ChatLayout', () => {
  const dummyChats = [
    {
      jid: '123456789@s.whatsapp.net',
      name: 'Jane Doe',
      unreadCount: 0,
      lastMessage: 'Hello SmartChat',
      lastMessageTimestamp: '1600000000',
      pinned: 0,
      muteExpiration: 0,
      profilePictureUrl: null
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders ChatList and empty state when no active chat is selected', async () => {
    const { apiService } = renderWithProviders(<ChatLayout />)
    apiService.getChats = vi.fn().mockResolvedValue(dummyChats)

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    expect(screen.getByText('Chats')).toBeInTheDocument()
    expect(screen.getByText('SmartChat')).toBeInTheDocument()
    expect(screen.getByText('Select a conversation to start messaging')).toBeInTheDocument()
  })

  it('selects a chat and renders header, message view, and input area', async () => {
    const { apiService } = renderWithProviders(<ChatLayout />)
    apiService.getChats = vi.fn().mockResolvedValue(dummyChats)
    apiService.getMessages = vi.fn().mockResolvedValue([
      {
        id: 'msg-1',
        chatJid: '123456789@s.whatsapp.net',
        fromMe: false,
        timestamp: '1600000000',
        status: 'READ',
        messageType: 'conversation',
        textContent: 'Hello SmartChat',
        participantName: 'Jane Doe'
      }
    ])

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const chatItem = screen.getByText('Jane Doe')
    fireEvent.click(chatItem)

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    expect(screen.getByTitle('Search messages')).toBeInTheDocument()
    expect(screen.getByText('Hello SmartChat')).toBeInTheDocument()
  })

  it('toggles AI Assistant sidebar when clicking AI edge tab', async () => {
    const { apiService } = renderWithProviders(<ChatLayout />)
    apiService.getChats = vi.fn().mockResolvedValue(dummyChats)

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const aiToggleBtn = screen.getByTitle('Open AI Assistant')
    fireEvent.click(aiToggleBtn)

    expect(screen.getByTitle('Close AI Assistant')).toBeInTheDocument()
  })

  it('toggles message search sidebar when clicking header search icon', async () => {
    const { apiService } = renderWithProviders(<ChatLayout />)
    apiService.getChats = vi.fn().mockResolvedValue(dummyChats)
    apiService.getMessages = vi.fn().mockResolvedValue([])

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    fireEvent.click(screen.getByText('Jane Doe'))

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const searchBtn = screen.getByTitle('Search messages')
    fireEvent.click(searchBtn)

    expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument()
  })
})
