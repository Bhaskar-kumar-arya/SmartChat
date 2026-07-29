import { vi } from 'vitest'
import { IAPIService } from '@renderer/services/IAPIService'

export function createMockApiService(overrides: Partial<IAPIService> = {}): IAPIService {
  const defaultMock: IAPIService = {
    getChats: vi.fn().mockResolvedValue([]),
    getChat: vi.fn().mockResolvedValue(null),
    getMessages: vi.fn().mockResolvedValue([]),
    getMessagesAround: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockImplementation((jid: string, text: string, quotedId?: string) =>
      Promise.resolve({
        id: `msg-${Date.now()}`,
        chatJid: jid,
        participant: 'me@s.whatsapp.net',
        messageType: 'conversation',
        textContent: text,
        content: text,
        timestamp: String(Date.now()),
        fromMe: true,
        status: 'SENT',
        quotedId,
      } as any)
    ),
    editMessage: vi.fn().mockImplementation((jid: string, messageId: string, newText: string) =>
      Promise.resolve({
        id: messageId,
        chatJid: jid,
        participant: 'me@s.whatsapp.net',
        messageType: 'conversation',
        textContent: newText,
        content: newText,
        timestamp: String(Date.now()),
        fromMe: true,
        status: 'SENT',
        isEdited: true,
      } as any)
    ),
    deleteMessage: vi.fn().mockResolvedValue(true),
    reactMessage: vi.fn().mockResolvedValue(undefined),
    sendMediaMessage: vi.fn().mockResolvedValue({} as any),
    getGroupParticipants: vi.fn().mockResolvedValue([]),
    downloadMedia: vi.fn().mockResolvedValue({} as any),
    markRead: vi.fn().mockResolvedValue(true),
    muteChat: vi.fn().mockResolvedValue(true),
    unmuteChat: vi.fn().mockResolvedValue(true),
    pinChat: vi.fn().mockResolvedValue(true),
    unpinChat: vi.fn().mockResolvedValue(true),
    getMyJid: vi.fn().mockResolvedValue('me@s.whatsapp.net'),
    logout: vi.fn().mockResolvedValue(true),
    openFile: vi.fn().mockResolvedValue(true),

    // Event Listeners
    onNewMessage: vi.fn().mockReturnValue(() => {}),
    onMessageEdited: vi.fn().mockReturnValue(() => {}),
    onMessageDeleted: vi.fn().mockReturnValue(() => {}),
    onChatUpdated: vi.fn().mockReturnValue(() => {}),
    onPresenceUpdate: vi.fn().mockReturnValue(() => {}),
    onWaQr: vi.fn().mockReturnValue(() => {}),
    onWaConnected: vi.fn().mockReturnValue(() => {}),
    onWaLoggedOut: vi.fn().mockReturnValue(() => {}),
    onWaSyncProgress: vi.fn().mockReturnValue(() => {}),
    onWaSyncStatus: vi.fn().mockReturnValue(() => {}),
    onWaSyncComplete: vi.fn().mockReturnValue(() => {}),
    skipSync: vi.fn(),
    getSyncFullHistory: vi.fn().mockResolvedValue(false),
    setSyncFullHistory: vi.fn().mockResolvedValue(true),
    getProfilePicture: vi.fn().mockResolvedValue(null),
    selectFile: vi.fn().mockResolvedValue(null),
    searchAll: vi.fn().mockResolvedValue({ chats: [], messages: [], media: [] }),
    indexEmbeddings: vi.fn().mockResolvedValue(undefined),
    onEmbeddingProgress: vi.fn().mockReturnValue(() => {}),
    onEmbeddingState: vi.fn().mockReturnValue(() => {}),
    clearVectors: vi.fn().mockResolvedValue(undefined),
    saveTempFile: vi.fn().mockResolvedValue('/tmp/file'),
    downloadUrlToTemp: vi.fn().mockResolvedValue('/tmp/file'),
    onMessageStatusUpdated: vi.fn().mockReturnValue(() => {}),
    getMessageReceipts: vi.fn().mockResolvedValue([]),

    // AI Chat & Session methods
    aiChatStream: vi.fn().mockReturnValue('channel-1'),
    abortAiChat: vi.fn().mockResolvedValue(true),
    executeTool: vi.fn().mockResolvedValue(null),
    getAiTools: vi.fn().mockResolvedValue([]),
    getAiModels: vi.fn().mockResolvedValue([]),
    resolveCitation: vi.fn().mockResolvedValue(null),
    resolveAllCitations: vi.fn().mockResolvedValue(new Map()),
    getAiOptions: vi.fn().mockResolvedValue({ model: 'gpt-4o', temperature: 0.7 } as any),
    setAiOptions: vi.fn().mockResolvedValue(undefined),
    createAiSession: vi.fn().mockImplementation((title: string, modelId?: string) =>
      Promise.resolve({
        id: `session-${Date.now()}`,
        title,
        modelId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any)
    ),
    getAiSession: vi.fn().mockResolvedValue(null),
    listAiSessions: vi.fn().mockResolvedValue([]),
    saveAiSessionMessages: vi.fn().mockResolvedValue(undefined),
    renameAiSession: vi.fn().mockResolvedValue(undefined),
    deleteAiSession: vi.fn().mockResolvedValue(undefined),
    cloneAiSession: vi.fn().mockResolvedValue({} as any),
    searchMentionContacts: vi.fn().mockResolvedValue([]),
    searchMentionChats: vi.fn().mockResolvedValue([]),
    getProviderKeys: vi.fn().mockResolvedValue({}),
    setProviderKey: vi.fn().mockResolvedValue(true),
    setAiAutoSave: vi.fn().mockResolvedValue(undefined),
    exportAiChat: vi.fn().mockResolvedValue(undefined),
    deleteExportedAiChat: vi.fn().mockResolvedValue(undefined),
    addStickerToFavorites: vi.fn().mockResolvedValue(true),
    removeStickerFromFavorites: vi.fn().mockResolvedValue(true),
    removeFavoriteStickerById: vi.fn().mockResolvedValue(true),
    isStickerFavorite: vi.fn().mockResolvedValue(false),
    getFavoriteStickers: vi.fn().mockResolvedValue([]),
    getPathForFile: vi.fn().mockImplementation((file: File) => (file as any).path || file.name),
    getNotificationPreferences: vi.fn().mockResolvedValue({
      soundEnabled: true,
      notificationsEnabled: true,
      previewEnabled: true,
    }),
    setNotificationPreferences: vi.fn().mockResolvedValue(undefined),
    setActiveChat: vi.fn().mockResolvedValue(undefined),
    onOpenChat: vi.fn().mockReturnValue(() => {}),

    // Extension System
    extensionList: vi.fn().mockResolvedValue([]),
    extensionInstall: vi.fn().mockResolvedValue({} as any),
    extensionUnload: vi.fn().mockResolvedValue(undefined),
    extensionReload: vi.fn().mockResolvedValue(undefined),
    extensionUninstall: vi.fn().mockResolvedValue(undefined),
    extensionGetLog: vi.fn().mockResolvedValue(''),
    extensionGetDocs: vi.fn().mockResolvedValue(''),
    extensionChatSend: vi.fn(),
    extensionChatHistory: vi.fn().mockResolvedValue([]),
    onExtensionChatPush: vi.fn().mockReturnValue(() => {}),
    onExtensionFocus: vi.fn().mockReturnValue(() => {}),

    // Contribution System
    getContributions: vi.fn().mockResolvedValue({
      'chat-action': [
        { pluginId: 'com.smartchat.builtin.whatsapp-core', id: 'pin', label: 'Pin Chat', when: { field: 'chat.isPinned', op: 'eq', value: false } },
        { pluginId: 'com.smartchat.builtin.whatsapp-core', id: 'unpin', label: 'Unpin Chat', when: { field: 'chat.isPinned', op: 'eq', value: true } },
        { pluginId: 'com.smartchat.builtin.whatsapp-core', id: 'archive', label: 'Archive Chat' },
        { pluginId: 'com.smartchat.builtin.whatsapp-core', id: 'unarchive', label: 'Unarchive Chat' },
        {
          pluginId: 'com.smartchat.builtin.whatsapp-core',
          id: 'mute',
          label: 'Mute Chat',
          when: { field: 'chat.isMuted', op: 'eq', value: false },
          subMenu: [
            { id: '8h', label: '8 Hours', args: { relativeMs: 28800000 } },
            { id: '1w', label: '1 Week', args: { relativeMs: 604800000 } },
            { id: 'always', label: 'Always', args: { durationMs: -1 } }
          ]
        },
        { pluginId: 'com.smartchat.builtin.whatsapp-core', id: 'unmute', label: 'Unmute Chat', when: { field: 'chat.isMuted', op: 'eq', value: true } },
        { pluginId: 'com.smartchat.builtin.whatsapp-core', id: 'mark-read', label: 'Mark as Read' }
      ]
    }),
    executeContribution: vi.fn().mockResolvedValue(undefined),
    onContributionsUpdated: vi.fn().mockReturnValue(() => {}),
  }


  return {
    ...defaultMock,
    ...overrides,
  }
}
