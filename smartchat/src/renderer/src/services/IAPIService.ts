import {
  ChatItem,
  MessageItem,
  SearchFilters,
  SearchResults,
  MessageReceiptInfo,
  PresenceUpdate,
  SelectedContext,
  NotificationPreferences
} from '../types/chatTypes'
import {
  AIChatMessage,
  AIChatOptions,
  ToolDefinition,
  ModelInfo,
  AIChatSessionItem,
  AIContextItem
} from '../types/aiTypes'
import { CitationEntity } from '../types/ai/citation.types'
import { ExtensionManifest, ExtensionChatMessage, LoadedExtension } from '../types/extension.types'

export interface IAPIService {
  getChats(page: number, limit: number): Promise<ChatItem[]>
  getChat(jid: string): Promise<ChatItem | null>
  getMessages(jid: string, page: number, limit: number): Promise<MessageItem[]>
  getMessagesAround(jid: string, messageId: string, lookBehind?: number): Promise<MessageItem[]>
  sendMessage(jid: string, text: string, quotedId?: string, mentions?: string[]): Promise<MessageItem>
  editMessage(jid: string, messageId: string, newText: string): Promise<MessageItem>
  deleteMessage(jid: string, messageId: string): Promise<boolean>
  reactMessage(jid: string, messageId: string, reaction: string): Promise<void>
  sendMediaMessage(
    jid: string,
    filePath: string,
    caption: string,
    quotedId?: string,
    mentions?: string[]
  ): Promise<MessageItem>
  getGroupParticipants(
    jid: string
  ): Promise<{ jid: string; name: string; isAdmin: boolean; isMe: boolean }[]>
  downloadMedia(msgId: string): Promise<MessageItem>
  markRead(jid: string): Promise<boolean>
  muteChat(jid: string, durationMs: number): Promise<boolean>
  unmuteChat(jid: string): Promise<boolean>
  pinChat(jid: string): Promise<boolean>
  unpinChat(jid: string): Promise<boolean>
  getMyJid(): Promise<string | null>
  logout(): Promise<boolean>
  openFile(localURI: string): Promise<boolean>

  // Event Listeners
  onNewMessage(callback: (msg: MessageItem) => void): (() => void)
  onMessageEdited(callback: (msg: MessageItem) => void): (() => void)
  onMessageDeleted(callback: (update: { id: string; chatJid: string; fromMe: boolean }) => void): (() => void)
  onChatUpdated(callback: (update: Partial<ChatItem> & { jid: string }) => void): (() => void)
  onPresenceUpdate(callback: (update: PresenceUpdate) => void): (() => void)
  onWaQr(callback: (qr: string) => void): (() => void)
  onWaConnected(callback: (data?: { isCatchup?: boolean }) => void): (() => void)
  onWaLoggedOut(callback: () => void): (() => void)
  onWaSyncProgress(
    callback: (data: { progress: number; syncType: number; syncFullHistory: boolean }) => void
  ): (() => void)
  onWaSyncStatus(callback: (status: string) => void): (() => void)
  onWaSyncComplete(callback: () => void): (() => void)
  skipSync(): void
  getSyncFullHistory(): Promise<boolean>
  setSyncFullHistory(full: boolean): Promise<boolean>
  getProfilePicture(
    jid: string,
    type: 'preview' | 'image',
    forceRefresh?: boolean
  ): Promise<string | null>
  selectFile(): Promise<string[] | null>
  searchAll(
    query: string,
    mode?: 'normal' | 'deep',
    filters?: SearchFilters
  ): Promise<SearchResults>
  indexEmbeddings(): Promise<void>
  onEmbeddingProgress(callback: (pct: number) => void): (() => void)
  onEmbeddingState(callback: (isActive: boolean) => void): (() => void)
  clearVectors(): Promise<void>
  saveTempFile(buffer: ArrayBuffer | Uint8Array, fileName: string): Promise<string>
  downloadUrlToTemp(url: string, fileName: string): Promise<string>
  onMessageStatusUpdated(
    callback: (update: { id: string; chatJid: string; status: string }) => void
  ): (() => void)
  getMessageReceipts(messageId: string): Promise<MessageReceiptInfo[]>

  // AI Chat & Session methods
  aiChatStream(
    prompt: string,
    contexts: AIContextItem[],
    history: AIChatMessage[],
    mentions: SelectedContext[],
    options: AIChatOptions & { isSystem?: boolean },
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onError: (err: Error) => void
  ): string
  abortAiChat(channelId: string): Promise<boolean>
  executeTool(toolName: string, args: Record<string, any>, sessionId?: string | null): Promise<any>
  getAiTools(): Promise<ToolDefinition[]>
  getAiModels(): Promise<ModelInfo[]>
  resolveCitation(sessionId: string, index: number): Promise<CitationEntity | null>
  resolveAllCitations(sessionId: string): Promise<ReadonlyMap<number, CitationEntity>>
  getAiOptions(): Promise<AIChatOptions>
  setAiOptions(options: AIChatOptions): Promise<void>
  createAiSession(title: string, modelId?: string): Promise<AIChatSessionItem>
  getAiSession(
    id: string
  ): Promise<{ id: string; title: string; messages: AIChatMessage[] } | null>
  listAiSessions(page: number, limit: number): Promise<AIChatSessionItem[]>
  saveAiSessionMessages(sessionId: string, messages: AIChatMessage[]): Promise<void>
  renameAiSession(id: string, title: string): Promise<void>
  deleteAiSession(id: string): Promise<void>
  cloneAiSession(id: string): Promise<AIChatSessionItem>
  searchMentionContacts(query: string): Promise<ChatItem[]>
  searchMentionChats(query: string): Promise<ChatItem[]>
  getProviderKeys(): Promise<Record<string, string>>
  setProviderKey(provider: string, key: string): Promise<boolean>
  setAiAutoSave(checked: boolean): Promise<void>
  exportAiChat(session: AIChatSessionItem, messages: AIChatMessage[]): Promise<void>
  deleteExportedAiChat(sessionId: string): Promise<void>
  addStickerToFavorites(msgId: string): Promise<boolean>
  removeStickerFromFavorites(msgId: string): Promise<boolean>
  removeFavoriteStickerById(id: string): Promise<boolean>
  isStickerFavorite(msgId: string): Promise<boolean>
  getFavoriteStickers(): Promise<any[]>
  getPathForFile(file: File): string
  getNotificationPreferences(): Promise<NotificationPreferences>
  setNotificationPreferences(prefs: Partial<NotificationPreferences>): Promise<void>
  setActiveChat(jid: string | null): Promise<void>
  onOpenChat(callback: (chat: { jid: string; name: string }) => void): (() => void)

  // ── Extension System (Phase 9) ──────────────────────────────────────
  extensionList(): Promise<LoadedExtension[]>
  extensionInstall(scextPath: string): Promise<ExtensionManifest>
  extensionUnload(id: string): Promise<void>
  extensionReload(id: string): Promise<void>
  extensionUninstall(id: string): Promise<void>
  extensionGetLog(id: string): Promise<string>
  extensionGetDocs(): Promise<string>
  extensionChatSend(extensionId: string, text: string): void
  extensionChatHistory(extensionId: string, limit?: number): Promise<ExtensionChatMessage[]>
  onExtensionChatPush(cb: (payload: { extensionId: string; message: ExtensionChatMessage }) => void): () => void
  onExtensionFocus(cb: (id: string) => void): () => void
}
