import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // ── Phase 1 & 2: Auth & Sync ──────────────────────────────────────
  onWaQr: (callback: (qr: string) => void) => {
    const listener = (_event: IpcRendererEvent, qr: string) => callback(qr)
    ipcRenderer.on('wa-qr', listener)
    return () => { ipcRenderer.removeListener('wa-qr', listener) }
  },
  onWaConnected: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('wa-connected', listener)
    return () => { ipcRenderer.removeListener('wa-connected', listener) }
  },
  onWaLoggedOut: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('wa-logged-out', listener)
    return () => { ipcRenderer.removeListener('wa-logged-out', listener) }
  },
  onWaSyncProgress: (callback: (data: { progress: number; syncType: number; syncFullHistory: boolean }) => void) => {
    const listener = (_event: IpcRendererEvent, data: unknown) => {
      // Handle backward compatibility if it's sent as a plain number
      if (typeof data === 'number') {
        callback({ progress: data, syncType: 3, syncFullHistory: false })
      } else {
        callback(data as { progress: number; syncType: number; syncFullHistory: boolean })
      }
    }
    ipcRenderer.on('wa-sync-progress', listener)
    return () => { ipcRenderer.removeListener('wa-sync-progress', listener) }
  },
  onWaSyncStatus: (callback: (status: string) => void) => {
    const listener = (_event: IpcRendererEvent, status: string) => callback(status)
    ipcRenderer.on('wa-sync-status', listener)
    return () => { ipcRenderer.removeListener('wa-sync-status', listener) }
  },
  onWaSyncComplete: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('wa-sync-complete', listener)
    return () => { ipcRenderer.removeListener('wa-sync-complete', listener) }
  },
  skipSync: () => {
    ipcRenderer.send('wa-skip-sync')
  },
  getSyncFullHistory: () => {
    return ipcRenderer.invoke('get-sync-full-history')
  },
  setSyncFullHistory: (full: boolean) => {
    return ipcRenderer.invoke('set-sync-full-history', full)
  },

  // ── Phase 3 & 4: Chat Data & Messaging ────────────────────────────
  getChats: (page: number = 1, pageSize: number = 50) => {
    return ipcRenderer.invoke('get-chats', page, pageSize)
  },
  getChat: (jid: string) => {
    return ipcRenderer.invoke('get-chat', jid)
  },
  getMessages: (jid: string, page: number = 1, pageSize: number = 50) => {
    return ipcRenderer.invoke('get-messages', jid, page, pageSize)
  },
  sendMessage: (jid: string, text: string, quotedMsgId?: string, mentions?: string[]) => {
    return ipcRenderer.invoke('send-message', jid, text, quotedMsgId, mentions)
  },
  editMessage: (jid: string, messageId: string, newText: string) => {
    return ipcRenderer.invoke('edit-message', jid, messageId, newText)
  },
  deleteMessage: (jid: string, messageId: string) => {
    return ipcRenderer.invoke('delete-message', jid, messageId)
  },
  reactMessage: (jid: string, messageId: string, reaction: string) => {
    return ipcRenderer.invoke('react-message', jid, messageId, reaction)
  },
  sendMediaMessage: (jid: string, filePath: string, caption?: string, quotedMsgId?: string, mentions?: string[]) => {
    return ipcRenderer.invoke('send-media-message', jid, filePath, caption, quotedMsgId, mentions)
  },
  getGroupParticipants: (jid: string) => {
    return ipcRenderer.invoke('get-group-participants', jid)
  },
  downloadMedia: (msgId: string) => {
    return ipcRenderer.invoke('download-media', msgId)
  },
  addStickerToFavorites: (msgId: string) => {
    return ipcRenderer.invoke('add-sticker-to-favorites', msgId)
  },
  removeStickerFromFavorites: (msgId: string) => {
    return ipcRenderer.invoke('remove-sticker-from-favorites', msgId)
  },
  removeFavoriteStickerById: (id: string) => {
    return ipcRenderer.invoke('remove-favorite-sticker-by-id', id)
  },
  isStickerFavorite: (msgId: string) => {
    return ipcRenderer.invoke('is-sticker-favorite', msgId)
  },
  getFavoriteStickers: () => {
    return ipcRenderer.invoke('get-favorite-stickers')
  },
  selectFile: () => {
    return ipcRenderer.invoke('select-file')
  },
  saveTempFile: (buffer: ArrayBuffer | Uint8Array, fileName: string) => {
    return ipcRenderer.invoke('save-temp-file', buffer, fileName)
  },
  downloadUrlToTemp: (url: string, fileName: string) => {
    return ipcRenderer.invoke('download-url-to-temp', url, fileName)
  },
  onNewMessage: (callback: (msg: Record<string, unknown>) => void) => {
    const listener = (_event: IpcRendererEvent, msg: unknown) => callback(msg as Record<string, unknown>)
    ipcRenderer.on('new-message', listener)
    return () => { ipcRenderer.removeListener('new-message', listener) }
  },
  onMessageEdited: (callback: (msg: Record<string, unknown>) => void) => {
    const listener = (_event: IpcRendererEvent, msg: unknown) => callback(msg as Record<string, unknown>)
    ipcRenderer.on('message-edited', listener)
    return () => { ipcRenderer.removeListener('message-edited', listener) }
  },
  onMessageDeleted: (callback: (update: { id: string, chatJid: string, fromMe: boolean }) => void) => {
    const listener = (_event: IpcRendererEvent, update: unknown) => callback(update as { id: string, chatJid: string, fromMe: boolean })
    ipcRenderer.on('message-deleted', listener)
    return () => { ipcRenderer.removeListener('message-deleted', listener) }
  },
  markRead: (jid: string) => {
    return ipcRenderer.invoke('mark-read', jid)
  },
  muteChat: (jid: string, durationMs: number) => {
    return ipcRenderer.invoke('mute-chat', jid, durationMs)
  },
  unmuteChat: (jid: string) => {
    return ipcRenderer.invoke('unmute-chat', jid)
  },
  pinChat: (jid: string) => {
    return ipcRenderer.invoke('pin-chat', jid)
  },
  unpinChat: (jid: string) => {
    return ipcRenderer.invoke('unpin-chat', jid)
  },
  getMyJid: () => {
    return ipcRenderer.invoke('get-my-jid')
  },
  onMessageStatusUpdated: (callback: (update: { id: string, chatJid: string, status: string }) => void) => {
    const listener = (_event: IpcRendererEvent, update: unknown) => callback(update as { id: string, chatJid: string, status: string })
    ipcRenderer.on('message-status-updated', listener)
    return () => { ipcRenderer.removeListener('message-status-updated', listener) }
  },
  getMessageReceipts: (messageId: string) => {
    return ipcRenderer.invoke('get-message-receipts', messageId)
  },
  onChatUpdated: (callback: (chat: Record<string, unknown>) => void) => {
    const listener = (_event: IpcRendererEvent, chat: unknown) => callback(chat as Record<string, unknown>)
    ipcRenderer.on('chat-updated', listener)
    return () => { ipcRenderer.removeListener('chat-updated', listener) }
  },
  logout: () => {
    return ipcRenderer.invoke('logout')
  },
  onPresenceUpdate: (callback: (update: Record<string, unknown>) => void) => {
    const listener = (_event: IpcRendererEvent, update: Record<string, unknown>) => callback(update)
    ipcRenderer.on('presence-update', listener)
    return () => { ipcRenderer.removeListener('presence-update', listener) }
  },
  openFile: (localURI: string) => {
    return ipcRenderer.invoke('open-file', localURI)
  },
  getProfilePicture: (jid: string, type: 'preview' | 'image', forceRefresh?: boolean) => {
    return ipcRenderer.invoke('get-profile-picture', jid, type, forceRefresh)
  },
  searchAll: (query: string, mode: 'normal' | 'deep' = 'normal', filters?: unknown) => {
    return ipcRenderer.invoke('search-all', query, mode, filters)
  },
  searchMentionContacts: (query: string) => {
    return ipcRenderer.invoke('search-mention-contacts', query)
  },
  searchMentionChats: (query: string) => {
    return ipcRenderer.invoke('search-mention-chats', query)
  },
  indexEmbeddings: () => {
    return ipcRenderer.invoke('index-embeddings')
  },
  onEmbeddingProgress: (callback: (pct: number) => void) => {
    const listener = (_event: IpcRendererEvent, pct: number) => callback(pct)
    ipcRenderer.on('embedding-progress', listener)
    return () => { ipcRenderer.removeListener('embedding-progress', listener) }
  },
  onEmbeddingState: (callback: (isActive: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, isActive: boolean) => callback(isActive)
    ipcRenderer.on('embedding-state', listener)
    return () => { ipcRenderer.removeListener('embedding-state', listener) }
  },
  clearVectors: () => {
    return ipcRenderer.invoke('clear-vectors')
  },

  // ── AI Methods ──────────────────────────────────────────────────────
  aiChat: (prompt: string, contextChats?: unknown[], history?: unknown[], mentions?: unknown[], options?: unknown) => {
    return ipcRenderer.invoke('ai-chat', prompt, contextChats, history, mentions, options)
  },
  aiChatStream: (prompt: string, contextChats: unknown[] | undefined, history: unknown[] | undefined, mentions: unknown[] | undefined, options: unknown | undefined, onChunk: (chunk: string) => void, onEnd: () => void, onError: (err: Error) => void) => {
    const channelId = `ai-chat-${Date.now()}`;
    const chunkListener = (_event: IpcRendererEvent, chunk: string) => onChunk(chunk);
    const endListener = () => {
      ipcRenderer.removeAllListeners(`${channelId}-chunk`);
      ipcRenderer.removeAllListeners(`${channelId}-end`);
      ipcRenderer.removeAllListeners(`${channelId}-error`);
      onEnd();
    };
    const errorListener = (_event: IpcRendererEvent, err: unknown) => {
      ipcRenderer.removeAllListeners(`${channelId}-chunk`);
      ipcRenderer.removeAllListeners(`${channelId}-end`);
      ipcRenderer.removeAllListeners(`${channelId}-error`);
      onError(err as Error);
    };

    ipcRenderer.on(`${channelId}-chunk`, chunkListener);
    ipcRenderer.on(`${channelId}-end`, endListener);
    ipcRenderer.on(`${channelId}-error`, errorListener);

    ipcRenderer.send('ai-chat-stream', { channelId, prompt, contextChats, history, mentions, options });
    return channelId;
  },

  abortAiChat: (channelId: string) => {
    return ipcRenderer.invoke('abort-ai-chat', channelId);
  },

  getChatContext: (jid: string) => {
    return ipcRenderer.invoke('get-chat-context', jid)
  },
  executeTool: (toolName: string, args: Record<string, unknown>) => {
    return ipcRenderer.invoke('execute-tool', toolName, args)
  },
  getAiTools: () => {
    return ipcRenderer.invoke('get-ai-tools')
  },
  getAiModels: () => {
    return ipcRenderer.invoke('get-ai-models')
  },
  getProviderKeys: () => {
    return ipcRenderer.invoke('get-provider-keys')
  },
  setProviderKey: (provider: string, key: string) => {
    return ipcRenderer.invoke('set-provider-key', provider, key)
  },

  // ── AI Session Methods ──────────────────────────────────────────────
  createAiSession: (title: string, modelId?: string) => {
    return ipcRenderer.invoke('ai-session-create', title, modelId)
  },
  listAiSessions: (page?: number, pageSize?: number) => {
    return ipcRenderer.invoke('ai-session-list', page, pageSize)
  },
  getAiSession: (id: string) => {
    return ipcRenderer.invoke('ai-session-get', id)
  },
  renameAiSession: (id: string, title: string) => {
    return ipcRenderer.invoke('ai-session-rename', id, title)
  },
  deleteAiSession: (id: string) => {
    return ipcRenderer.invoke('ai-session-delete', id)
  },
  cloneAiSession: (id: string) => {
    return ipcRenderer.invoke('ai-session-clone', id)
  },
  saveAiSessionMessages: (sessionId: string, messages: unknown[]) => {
    return ipcRenderer.invoke('ai-session-save-messages', sessionId, messages)
  },
  getAiAutoSave: () => {
    return ipcRenderer.invoke('ai-session-get-autosave')
  },
  setAiAutoSave: (enabled: boolean) => {
    return ipcRenderer.invoke('ai-session-set-autosave', enabled)
  },
  getAiOptions: () => {
    return ipcRenderer.invoke('get-ai-options')
  },
  setAiOptions: (options: unknown) => {
    return ipcRenderer.invoke('set-ai-options', options)
  },
  exportAiChat: (session: unknown, messages: unknown[]) => {
    return ipcRenderer.invoke('export-ai-chat', session, messages)
  },
  deleteExportedAiChat: (sessionId: string) => {
    return ipcRenderer.invoke('delete-exported-ai-chat', sessionId)
  },
  duplicateExportedAiChat: (sessionId: string) => {
    return ipcRenderer.invoke('duplicate-exported-ai-chat', sessionId)
  },
  getNotificationPreferences: () => {
    return ipcRenderer.invoke('get-notification-preferences')
  },
  setNotificationPreferences: (prefs: unknown) => {
    return ipcRenderer.invoke('set-notification-preferences', prefs)
  },
  setActiveChat: (jid: string | null) => {
    return ipcRenderer.invoke('set-active-chat', jid)
  },
  onOpenChat: (callback: (chat: { jid: string; name: string }) => void) => {
    const listener = (_event: IpcRendererEvent, chat: { jid: string; name: string }) => callback(chat)
    ipcRenderer.on('open-chat', listener)
    return () => { ipcRenderer.removeListener('open-chat', listener) }
  },

  // ── File Utilities ──────────────────────────────────────────────────
  // webUtils.getPathForFile is the modern Electron API to get the real
  // filesystem path of a File object dropped into the renderer.
  getPathForFile: (file: File): string => {
    return webUtils.getPathForFile(file)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
