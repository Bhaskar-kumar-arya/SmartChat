import { ChatItem, MessageItem, SearchFilters, SearchResults } from '../types'

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

  onWaSyncProgress: (callback: (progress: number) => void) =>
    window.api.onWaSyncProgress(callback),

  onWaSyncComplete: (callback: () => void) =>
    window.api.onWaSyncComplete(callback),

  skipSync: () =>
    window.api.skipSync(),

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

  clearVectors: (): Promise<void> =>
    window.api.clearVectors(),

  saveTempFile: (buffer: ArrayBuffer | Uint8Array, fileName: string): Promise<string> =>
    window.api.saveTempFile(buffer, fileName),
}
