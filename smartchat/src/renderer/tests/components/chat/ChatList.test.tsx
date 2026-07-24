import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, act } from '../../testUtils'
import { createMockApiService } from '../../mocks/mockApiService'
import ChatList from '@renderer/components/chat/ChatList'

describe('ChatList', () => {
  const dummyChats = [
    {
      jid: '123456789@s.whatsapp.net',
      name: 'Alice Smith',
      unreadCount: 2,
      lastMessage: 'Hello there!',
      lastMessageTimestamp: '1600000000',
      pinned: 0,
      muteExpiration: 0,
      profilePictureUrl: 'https://example.com/alice.jpg'
    },
    {
      jid: '987654321@s.whatsapp.net',
      name: 'Bob Jones',
      unreadCount: 0,
      lastMessage: 'See you tomorrow',
      lastMessageTimestamp: '1600000100',
      pinned: 1,
      muteExpiration: 0,
      profilePictureUrl: null
    }
  ]

  const defaultProps = {
    activeJid: null,
    onSelectChat: vi.fn(),
    onShowProfilePic: vi.fn(),
    onOpenExtensionChat: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and renders list of chats', async () => {
    const mockApi = createMockApiService()
    mockApi.getChats = vi.fn().mockResolvedValue(dummyChats)

    renderWithProviders(<ChatList {...defaultProps} />, { apiService: mockApi })

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    expect(screen.getByText('Chats')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('Hello there!')).toBeInTheDocument()
  })

  it('shows empty state when no chats are available', async () => {
    const mockApi = createMockApiService()
    mockApi.getChats = vi.fn().mockResolvedValue([])

    renderWithProviders(<ChatList {...defaultProps} />, { apiService: mockApi })

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    expect(screen.getByText('No chats yet')).toBeInTheDocument()
  })

  it('triggers onSelectChat when a chat item is clicked', async () => {
    const onSelectChat = vi.fn()
    const mockApi = createMockApiService()
    mockApi.getChats = vi.fn().mockResolvedValue(dummyChats)

    renderWithProviders(
      <ChatList {...defaultProps} onSelectChat={onSelectChat} />,
      { apiService: mockApi }
    )

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const aliceItem = screen.getByText('Alice Smith')
    fireEvent.click(aliceItem)

    expect(onSelectChat).toHaveBeenCalledWith(
      '123456789@s.whatsapp.net',
      'Alice Smith',
      'https://example.com/alice.jpg'
    )
  })

  it('opens context menu on right click of a chat item', async () => {
    const mockApi = createMockApiService()
    mockApi.getChats = vi.fn().mockResolvedValue(dummyChats)

    renderWithProviders(<ChatList {...defaultProps} />, { apiService: mockApi })

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const aliceItem = screen.getByText('Alice Smith')
    fireEvent.contextMenu(aliceItem)

    expect(screen.getByText('Pin Chat')).toBeInTheDocument()
    expect(screen.getByText('Mute Chat')).toBeInTheDocument()
  })

  it('opens index confirmation modal when sparkle button is clicked', async () => {
    const mockApi = createMockApiService()
    mockApi.getChats = vi.fn().mockResolvedValue(dummyChats)

    renderWithProviders(<ChatList {...defaultProps} />, { apiService: mockApi })

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const indexBtn = screen.getByTitle('Index for Semantic Search')
    fireEvent.click(indexBtn)

    expect(screen.getByText('Index for Semantic Search')).toBeInTheDocument()
  })

  it('opens logout confirmation modal when logout button is clicked', async () => {
    const mockApi = createMockApiService()
    mockApi.getChats = vi.fn().mockResolvedValue(dummyChats)

    renderWithProviders(<ChatList {...defaultProps} />, { apiService: mockApi })

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const logoutBtn = screen.getByTitle('Logout')
    fireEvent.click(logoutBtn)

    expect(screen.getByText('Logout and delete all data?')).toBeInTheDocument()
  })

  it('opens settings modal when settings button is clicked', async () => {
    const mockApi = createMockApiService()
    mockApi.getChats = vi.fn().mockResolvedValue(dummyChats)

    renderWithProviders(<ChatList {...defaultProps} />, { apiService: mockApi })

    await act(async () => {
      await new Promise(r => setTimeout(r, 50))
    })

    const settingsBtn = screen.getByTitle('Settings')
    fireEvent.click(settingsBtn)

    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})
