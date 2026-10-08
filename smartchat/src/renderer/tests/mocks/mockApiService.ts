import { vi, type Mock } from 'vitest'
import { act } from '@testing-library/react'
import { IAPIService } from '@renderer/services/IAPIService'

// ---------------------------------------------------------------------------
// Typed event emitters (R-UICHAT-01)
//
// Every on* subscription on IAPIService is mocked to register its callback in
// a per-service registry and return a real unsubscribe. Tests then fire the
// event through `api.emit.<name>(...)` (or `api.emit.event('onX', ...)`), which
// calls the registered callbacks inside `act()` so React state flushes.
// Payload types are derived from IAPIService, so signature drift fails typecheck.
// ---------------------------------------------------------------------------

type ApiEventName = {
  [K in keyof Required<IAPIService>]: K extends `on${string}` ? K : never
}[keyof Required<IAPIService>]

/** Callback parameters of an on* subscription, e.g. [msg: MessageItem]. */
type EventArgs<K extends ApiEventName> = Required<IAPIService>[K] extends (
  cb: (...args: infer A) => void
) => unknown
  ? A
  : Required<IAPIService>[K] extends (cb: infer F) => unknown
    ? F extends (...args: infer A) => void
      ? A
      : never
    : never

type EmitName<K extends string> = K extends `on${infer N}` ? Uncapitalize<N> : never

export type MockApiEmitters = {
  [K in ApiEventName as EmitName<K>]: (...args: EventArgs<K>) => void
} & {
  /** Generic form: `emit.event('onNewMessage', msg)`. */
  event: <K extends ApiEventName>(name: K, ...args: EventArgs<K>) => void
  /** Number of live subscribers for an event (to assert unsubscribe on unmount). */
  listenerCount: (name: ApiEventName) => number
}

export type MockApiService = IAPIService & { emit: MockApiEmitters }

// Exhaustive on purpose: adding an on* method to IAPIService fails typecheck
// here until the mock learns about it.
const EVENT_NAMES: Record<ApiEventName, true> = {
  onNewMessage: true,
  onMessageEdited: true,
  onMessageDeleted: true,
  onChatUpdated: true,
  onPresenceUpdate: true,
  onWaQr: true,
  onWaConnected: true,
  onWaLoggedOut: true,
  onWaSessionReplaced: true,
  onWaSyncProgress: true,
  onWaSyncStatus: true,
  onWaSyncComplete: true,
  onWaHistoryAppended: true,
  onEmbeddingProgress: true,
  onEmbeddingState: true,
  onMessageStatusUpdated: true,
  onOpenChat: true,
  onExtensionChatPush: true,
  onExtensionFocus: true,
  onContributionsUpdated: true,
  onModalShow: true,
  onOverlayShow: true,
  onOverlaySend: true,
  onOverlayClose: true,
}

type AnyCb = (...args: unknown[]) => void

function createEventHub(): {
  subscriptions: Record<string, Mock>
  emit: MockApiEmitters
} {
  const registry = new Map<string, Set<AnyCb>>()
  const subscriptions: Record<string, Mock> = {}
  const fire = (name: string, args: unknown[]): void => {
    const cbs = [...(registry.get(name) ?? [])]
    act(() => {
      cbs.forEach((cb) => cb(...args))
    })
  }
  const emit: Record<string, unknown> = {
    event: (name: string, ...args: unknown[]) => fire(name, args),
    listenerCount: (name: string) => registry.get(name)?.size ?? 0,
  }
  for (const name of Object.keys(EVENT_NAMES)) {
    registry.set(name, new Set())
    subscriptions[name] = vi.fn((cb: AnyCb) => {
      registry.get(name)!.add(cb)
      return () => {
        registry.get(name)!.delete(cb)
      }
    })
    const short = name.slice(2, 3).toLowerCase() + name.slice(3)
    emit[short] = (...args: unknown[]) => fire(name, args)
  }
  return { subscriptions, emit: emit as MockApiEmitters }
}

export function createMockApiService(overrides: Partial<IAPIService> = {}): MockApiService {
  const hub = createEventHub()
  const defaultMock = {
    ...(hub.subscriptions as unknown as Partial<IAPIService>),
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
    retryMessage: vi.fn().mockImplementation((jid: string, messageId: string) =>
      Promise.resolve({ id: `${messageId}-retry`, chatJid: jid, fromMe: true, status: 'PENDING' } as never)
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
    skipSync: vi.fn(),
    getSyncFullHistory: vi.fn().mockResolvedValue(false),
    setSyncFullHistory: vi.fn().mockResolvedValue(true),
    fetchMessageHistory: vi.fn().mockResolvedValue({ status: 'no-anchor' }),
    getProfilePicture: vi.fn().mockResolvedValue(null),
    selectFile: vi.fn().mockResolvedValue(null),
    searchAll: vi.fn().mockResolvedValue({ chats: [], messages: [], media: [] }),
    indexEmbeddings: vi.fn().mockResolvedValue(undefined),
    clearVectors: vi.fn().mockResolvedValue(undefined),
    saveTempFile: vi.fn().mockResolvedValue('/tmp/file'),
    downloadUrlToTemp: vi.fn().mockResolvedValue('/tmp/file'),
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

    // Declarative Modal API
    resolveModal: vi.fn(),

    // Webview Overlay API
    overlaySubmit: vi.fn(),
    overlayEvent: vi.fn(),
    overlayDismiss: vi.fn(),
    getOverlayPreloadPath: vi.fn().mockReturnValue('file:///mock/overlay-preload.js'),
  } as IAPIService

  return {
    ...defaultMock,
    ...overrides,
    emit: hub.emit,
  }
}
