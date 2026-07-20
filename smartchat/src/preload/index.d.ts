import { ElectronAPI } from '@electron-toolkit/preload'
import {
  ChatItem,
  MessageItem,
  SearchResultItem,
  SearchResults,
  AIChatMessage,
  AIChatOptions,
  ToolDefinition,
  ModelInfo,
  AIChatSessionItem,
  PresenceUpdate,
  AIContextItem,
  SelectedContext,
  SearchFilters,
  MessageReceiptInfo,
  NotificationPreferences
} from '../renderer/src/types'
import { CitationEntity } from '../renderer/src/types/ai/citation.types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // Phase 1 & 2
      onWaQr: (callback: (qr: string) => void) => () => void
      onWaConnected: (callback: () => void) => () => void
      onWaLoggedOut: (callback: () => void) => () => void
      onWaSyncProgress: (callback: (data: { progress: number; syncType: number; syncFullHistory: boolean }) => void) => () => void
      onWaSyncStatus: (callback: (status: string) => void) => () => void
      onWaSyncComplete: (callback: () => void) => () => void
      skipSync: () => void
      getSyncFullHistory: () => Promise<boolean>
      setSyncFullHistory: (full: boolean) => Promise<boolean>
      
      // Phase 3 & 4
      getChats: (page?: number, pageSize?: number) => Promise<ChatItem[]>
      getChat: (jid: string) => Promise<ChatItem | null>
      getMessages: (jid: string, page?: number, pageSize?: number) => Promise<MessageItem[]>
      getMessagesAround: (jid: string, messageId: string, lookBehind?: number) => Promise<MessageItem[]>
      sendMessage: (jid: string, text: string, quotedMsgId?: string, mentions?: string[]) => Promise<MessageItem>
      editMessage: (jid: string, messageId: string, newText: string) => Promise<MessageItem>
      deleteMessage: (jid: string, messageId: string) => Promise<boolean>
      reactMessage: (jid: string, messageId: string, reaction: string) => Promise<void>
      sendMediaMessage: (jid: string, filePath: string, caption?: string, quotedMsgId?: string, mentions?: string[]) => Promise<MessageItem>
      getGroupParticipants: (jid: string) => Promise<{ jid: string, name: string, isAdmin: boolean, isMe: boolean }[]>
      downloadMedia: (msgId: string) => Promise<MessageItem>
      addStickerToFavorites: (msgId: string) => Promise<boolean>
      removeStickerFromFavorites: (msgId: string) => Promise<boolean>
      removeFavoriteStickerById: (id: string) => Promise<boolean>
      isStickerFavorite: (msgId: string) => Promise<boolean>
      getFavoriteStickers: () => Promise<any[]>
      selectFile: () => Promise<string[] | null>
      onNewMessage: (callback: (msg: MessageItem) => void) => () => void
      onMessageEdited: (callback: (msg: MessageItem) => void) => () => void
      onMessageDeleted: (callback: (update: { id: string, chatJid: string, fromMe: boolean }) => void) => () => void
      markRead: (jid: string) => Promise<boolean>
      muteChat: (jid: string, durationMs: number) => Promise<boolean>
      unmuteChat: (jid: string) => Promise<boolean>
      pinChat: (jid: string) => Promise<boolean>
      unpinChat: (jid: string) => Promise<boolean>
      getMyJid: () => Promise<string | null>
      onMessageStatusUpdated: (callback: (update: { id: string, chatJid: string, status: string }) => void) => () => void
      getMessageReceipts: (messageId: string) => Promise<MessageReceiptInfo[]>
      onChatUpdated: (callback: (chat: Partial<ChatItem> & { jid: string }) => void) => () => void
      logout: () => Promise<boolean>
      onPresenceUpdate: (callback: (update: PresenceUpdate) => void) => () => void
      openFile: (localURI: string) => Promise<boolean>
      getProfilePicture: (jid: string, type: 'preview' | 'image', forceRefresh?: boolean) => Promise<string | null>
      saveTempFile: (buffer: ArrayBuffer | Uint8Array, fileName: string) => Promise<string>
      downloadUrlToTemp: (url: string, fileName: string) => Promise<string>
      searchAll: (query: string, mode?: 'normal' | 'deep', filters?: SearchFilters) => Promise<SearchResults>
      searchMentionContacts: (query: string) => Promise<ChatItem[]>
      searchMentionChats: (query: string) => Promise<ChatItem[]>
      indexEmbeddings: () => Promise<void>
      onEmbeddingProgress: (callback: (pct: number) => void) => () => void
      onEmbeddingState: (callback: (isActive: boolean) => void) => () => void
      clearVectors: () => Promise<void>
      aiChat: (
        prompt: string,
        contextChats?: AIContextItem[],
        history?: AIChatMessage[],
        mentions?: SelectedContext[],
        options?: AIChatOptions & { isSystem?: boolean }
      ) => Promise<string>
      aiChatStream: (
        prompt: string,
        contextChats: AIContextItem[] | undefined,
        history: AIChatMessage[] | undefined,
        mentions: SelectedContext[] | undefined,
        options: (AIChatOptions & { isSystem?: boolean }) | undefined,
        onChunk: (chunk: string) => void,
        onEnd: () => void,
        onError: (err: Error) => void
      ) => string
      abortAiChat: (channelId: string) => Promise<boolean>

      getChatContext: (jid: string) => Promise<MessageItem[]>
      executeTool: (toolName: string, args: Record<string, any>, sessionId?: string | null) => Promise<any>
      getAiTools: () => Promise<ToolDefinition[]>
      getAiModels: () => Promise<ModelInfo[]>
      resolveCitation: (sessionId: string, index: number) => Promise<CitationEntity | null>
      resolveAllCitations: (sessionId: string) => Promise<[number, CitationEntity][]>
      getProviderKeys: () => Promise<Record<string, string>>
      setProviderKey: (provider: string, key: string) => Promise<boolean>

      // ── AI Session Methods ──────────────────────────────────────────────
      createAiSession: (title: string, modelId?: string) => Promise<AIChatSessionItem>
      listAiSessions: (page?: number, pageSize?: number) => Promise<AIChatSessionItem[]>
      getAiSession: (id: string) => Promise<{ id: string; title: string; messages: AIChatMessage[] } | null>
      renameAiSession: (id: string, title: string) => Promise<void>
      deleteAiSession: (id: string) => Promise<void>
      cloneAiSession: (id: string) => Promise<AIChatSessionItem>
      saveAiSessionMessages: (sessionId: string, messages: AIChatMessage[]) => Promise<void>
      getAiAutoSave: () => Promise<boolean>
      setAiAutoSave: (enabled: boolean) => Promise<void>
      getAiOptions: () => Promise<AIChatOptions>
      setAiOptions: (options: AIChatOptions) => Promise<void>
      exportAiChat: (session: AIChatSessionItem, messages: AIChatMessage[]) => Promise<void>
      deleteExportedAiChat: (sessionId: string) => Promise<void>
      duplicateExportedAiChat: (sessionId: string) => Promise<void>
      getNotificationPreferences: () => Promise<NotificationPreferences>
      setNotificationPreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>
      setActiveChat: (jid: string | null) => Promise<void>
      onOpenChat: (callback: (chat: { jid: string; name: string }) => void) => () => void
      getPathForFile: (file: File) => string

      // ── Extension System (Phase 9) ──────────────────────────────────────
      extensionList: () => Promise<Array<{ id: string; manifest: import('../renderer/src/types/extension.types').ExtensionManifest }>>
      extensionInstall: (scextPath: string) => Promise<import('../renderer/src/types/extension.types').ExtensionManifest>
      extensionUnload: (id: string) => Promise<void>
      extensionReload: (id: string) => Promise<void>
      extensionUninstall: (id: string) => Promise<void>
      extensionGetLog: (id: string) => Promise<string>
      extensionGetDocs: () => Promise<string>
      extensionChatSend: (extensionId: string, text: string) => void
      extensionChatHistory: (extensionId: string, limit?: number) => Promise<import('../renderer/src/types/extension.types').ExtensionChatMessage[]>
      onExtensionChatPush: (cb: (payload: { extensionId: string; message: import('../renderer/src/types/extension.types').ExtensionChatMessage }) => void) => () => void
      onExtensionFocus: (cb: (id: string) => void) => () => void
    }
  }
}
