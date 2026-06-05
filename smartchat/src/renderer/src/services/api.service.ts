import { ChatItem, MessageItem, SearchFilters, SearchResults, MessageReceiptInfo, AIChatMessage, AIChatOptions, ToolDefinition, ModelInfo, AIChatSessionItem } from '../types'

// This service wraps the window.api (Electron bridge) to provide a clean abstraction.
// It allows us to mock the API in tests and decouple from the global window object.

/**
 * Service for interacting with the main process API via IPC.
 * This satisfies the Dependency Inversion Principle.
 */
export const api = {
  getChats: (page: number, limit: number): Promise<ChatItem[]> => 
    window.api.getChats(page, limit),

  getMessages: (jid: string, page: number, limit: number): Promise<MessageItem[]> =>
    window.api.getMessages(jid, page, limit),

  sendMessage: (jid: string, text: string, quotedId?: string, mentions?: string[]): Promise<MessageItem> =>
    window.api.sendMessage(jid, text, quotedId, mentions),

  editMessage: (jid: string, messageId: string, newText: string): Promise<MessageItem> =>
    window.api.editMessage(jid, messageId, newText),

  deleteMessage: (jid: string, messageId: string): Promise<boolean> =>
    window.api.deleteMessage(jid, messageId),

  sendMediaMessage: (jid: string, filePath: string, caption: string, quotedId?: string, mentions?: string[]): Promise<MessageItem> =>
    window.api.sendMediaMessage(jid, filePath, caption, quotedId, mentions),

  getGroupParticipants: (jid: string): Promise<{ jid: string, name: string, isAdmin: boolean, isMe: boolean }[]> =>
    window.api.getGroupParticipants(jid),

  downloadMedia: (msgId: string): Promise<MessageItem> =>
    window.api.downloadMedia(msgId),

  markRead: (jid: string): Promise<boolean> =>
    window.api.markRead(jid),

  logout: (): Promise<boolean> =>
    window.api.logout(),

  openFile: (localURI: string): Promise<boolean> =>
    window.api.openFile(localURI),

  // Event Listeners
  onNewMessage: (callback: (msg: MessageItem) => void) =>
    window.api.onNewMessage(callback),

  onMessageEdited: (callback: (msg: MessageItem) => void) =>
    window.api.onMessageEdited(callback),

  onMessageDeleted: (callback: (update: { id: string, chatJid: string, fromMe: boolean }) => void) =>
    window.api.onMessageDeleted(callback),

  onChatUpdated: (callback: (update: Partial<ChatItem> & { jid: string }) => void) =>
    window.api.onChatUpdated(callback),

  onPresenceUpdate: (callback: (update: any) => void) =>
    window.api.onPresenceUpdate(callback),

  onWaQr: (callback: (qr: string) => void) =>
    window.api.onWaQr(callback),

  onWaConnected: (callback: () => void) =>
    window.api.onWaConnected(callback),

  onWaLoggedOut: (callback: () => void) =>
    window.api.onWaLoggedOut(callback),

  onWaSyncProgress: (callback: (data: { progress: number; syncType: number; syncFullHistory: boolean }) => void) =>
    window.api.onWaSyncProgress(callback),

  onWaSyncStatus: (callback: (status: string) => void) =>
    window.api.onWaSyncStatus(callback),

  onWaSyncComplete: (callback: () => void) =>
    window.api.onWaSyncComplete(callback),

  skipSync: () =>
    window.api.skipSync(),

  getSyncFullHistory: (): Promise<boolean> =>
    window.api.getSyncFullHistory(),

  setSyncFullHistory: (full: boolean): Promise<boolean> =>
    window.api.setSyncFullHistory(full),

  getProfilePicture: (jid: string, type: 'preview' | 'image', forceRefresh?: boolean): Promise<string | null> =>
    window.api.getProfilePicture(jid, type, forceRefresh),

  selectFile: (): Promise<string | null> =>
    window.api.selectFile(),

  searchAll: (query: string, mode: 'normal' | 'deep' = 'normal', filters?: SearchFilters): Promise<SearchResults> =>
    window.api.searchAll(query, mode, filters),

  indexEmbeddings: (): Promise<void> =>
    window.api.indexEmbeddings(),

  onEmbeddingProgress: (callback: (pct: number) => void) =>
    window.api.onEmbeddingProgress(callback),

  onEmbeddingState: (callback: (isActive: boolean) => void) =>
    window.api.onEmbeddingState(callback),

  clearVectors: (): Promise<void> =>
    window.api.clearVectors(),

  saveTempFile: (buffer: ArrayBuffer | Uint8Array, fileName: string): Promise<string> =>
    window.api.saveTempFile(buffer, fileName),

  onMessageStatusUpdated: (callback: (update: { id: string, chatJid: string, status: string }) => void) =>
    window.api.onMessageStatusUpdated(callback),

  getMessageReceipts: (messageId: string): Promise<MessageReceiptInfo[]> =>
    window.api.getMessageReceipts(messageId),

  // AI Chat & Session methods
  aiChatStream: (
    prompt: string,
    contexts: any[],
    history: AIChatMessage[],
    mentions: any[],
    options: AIChatOptions & { isSystem?: boolean },
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onError: (err: any) => void
  ): string => window.api.aiChatStream(prompt, contexts, history, mentions, options, onChunk, onComplete, onError),

  abortAiChat: (channelId: string): Promise<boolean> =>
    window.api.abortAiChat(channelId),

  executeTool: (toolName: string, args: any): Promise<any> =>
    window.api.executeTool(toolName, args),

  getAiTools: (): Promise<ToolDefinition[]> =>
    window.api.getAiTools(),

  getAiModels: (): Promise<ModelInfo[]> =>
    window.api.getAiModels(),

  getAiOptions: (): Promise<AIChatOptions> =>
    window.api.getAiOptions(),

  setAiOptions: (options: AIChatOptions): Promise<void> =>
    window.api.setAiOptions(options),

  createAiSession: (title: string, modelId?: string): Promise<AIChatSessionItem> =>
    window.api.createAiSession(title, modelId),

  getAiSession: (id: string): Promise<{ id: string; title: string; messages: AIChatMessage[] } | null> =>
    window.api.getAiSession(id),

  listAiSessions: (page: number, limit: number): Promise<AIChatSessionItem[]> =>
    window.api.listAiSessions(page, limit),

  saveAiSessionMessages: (sessionId: string, messages: AIChatMessage[]): Promise<void> =>
    window.api.saveAiSessionMessages(sessionId, messages),

  renameAiSession: (id: string, title: string): Promise<void> =>
    window.api.renameAiSession(id, title),

  deleteAiSession: (id: string): Promise<void> =>
    window.api.deleteAiSession(id),

  cloneAiSession: (id: string): Promise<any> =>
    window.api.cloneAiSession(id),

  searchMentionContacts: (query: string): Promise<ChatItem[]> =>
    window.api.searchMentionContacts(query),

  searchMentionChats: (query: string): Promise<ChatItem[]> =>
    window.api.searchMentionChats(query),

  getProviderKeys: (): Promise<any> =>
    window.api.getProviderKeys(),

  setProviderKey: (provider: string, key: string): Promise<any> =>
    window.api.setProviderKey(provider, key),

  setAiAutoSave: (checked: boolean): Promise<any> =>
    window.api.setAiAutoSave(checked),

  exportAiChat: (session: any, messages: any[]): Promise<any> =>
    window.api.exportAiChat(session, messages),

  deleteExportedAiChat: (sessionId: string): Promise<any> =>
    window.api.deleteExportedAiChat(sessionId),
}

