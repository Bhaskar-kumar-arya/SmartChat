import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // ── Phase 1 & 2: Auth & Sync ──────────────────────────────────────
  onWaQr: (callback: (qr: string) => void) => {
    const listener = (_event: any, qr: string) => callback(qr)
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
  onWaSyncProgress: (callback: (progress: number) => void) => {
    const listener = (_event: any, progress: number) => callback(progress)
    ipcRenderer.on('wa-sync-progress', listener)
    return () => { ipcRenderer.removeListener('wa-sync-progress', listener) }
  },
  onWaSyncComplete: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('wa-sync-complete', listener)
    return () => { ipcRenderer.removeListener('wa-sync-complete', listener) }
  },
  skipSync: () => {
    ipcRenderer.send('wa-skip-sync')
  },

  // ── Phase 3 & 4: Chat Data & Messaging ────────────────────────────
  getChats: (page: number = 1, pageSize: number = 50) => {
    return ipcRenderer.invoke('get-chats', page, pageSize)
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
  sendMediaMessage: (jid: string, filePath: string, caption?: string, quotedMsgId?: string, mentions?: string[]) => {
    return ipcRenderer.invoke('send-media-message', jid, filePath, caption, quotedMsgId, mentions)
  },
  getGroupParticipants: (jid: string) => {
    return ipcRenderer.invoke('get-group-participants', jid)
  },
  downloadMedia: (msgId: string) => {
    return ipcRenderer.invoke('download-media', msgId)
  },
  selectFile: () => {
    return ipcRenderer.invoke('select-file')
  },
  saveTempFile: (buffer: ArrayBuffer | Uint8Array, fileName: string) => {
    return ipcRenderer.invoke('save-temp-file', buffer, fileName)
  },
  onNewMessage: (callback: (msg: Record<string, unknown>) => void) => {
    const listener = (_event: any, msg: any) => callback(msg)
    ipcRenderer.on('new-message', listener)
    return () => { ipcRenderer.removeListener('new-message', listener) }
  },
  onMessageEdited: (callback: (msg: Record<string, unknown>) => void) => {
    const listener = (_event: any, msg: any) => callback(msg)
    ipcRenderer.on('message-edited', listener)
    return () => { ipcRenderer.removeListener('message-edited', listener) }
  },
  onMessageDeleted: (callback: (update: { id: string, remoteJid: string, fromMe: boolean }) => void) => {
    const listener = (_event: any, update: any) => callback(update)
    ipcRenderer.on('message-deleted', listener)
    return () => { ipcRenderer.removeListener('message-deleted', listener) }
  },
  markRead: (jid: string) => {
    return ipcRenderer.invoke('mark-read', jid)
  },
  onChatUpdated: (callback: (chat: Record<string, unknown>) => void) => {
    const listener = (_event: any, chat: any) => callback(chat)
    ipcRenderer.on('chat-updated', listener)
    return () => { ipcRenderer.removeListener('chat-updated', listener) }
  },
  logout: () => {
    return ipcRenderer.invoke('logout')
  },
  onPresenceUpdate: (callback: (update: Record<string, any>) => void) => {
    const listener = (_event: any, update: any) => callback(update)
    ipcRenderer.on('presence-update', listener)
    return () => { ipcRenderer.removeListener('presence-update', listener) }
  },
  openFile: (localURI: string) => {
    return ipcRenderer.invoke('open-file', localURI)
  },
  getProfilePicture: (jid: string, type: 'preview' | 'image', forceRefresh?: boolean) => {
    return ipcRenderer.invoke('get-profile-picture', jid, type, forceRefresh)
  },
  searchAll: (query: string, mode: 'normal' | 'deep' = 'normal', filters?: any) => {
    return ipcRenderer.invoke('search-all', query, mode, filters)
  },
  indexEmbeddings: () => {
    return ipcRenderer.invoke('index-embeddings')
  },
  onEmbeddingProgress: (callback: (pct: number) => void) => {
    const listener = (_event: any, pct: number) => callback(pct)
    ipcRenderer.on('embedding-progress', listener)
    return () => { ipcRenderer.removeListener('embedding-progress', listener) }
  },
  onEmbeddingState: (callback: (isActive: boolean) => void) => {
    const listener = (_event: any, isActive: boolean) => callback(isActive)
    ipcRenderer.on('embedding-state', listener)
    return () => { ipcRenderer.removeListener('embedding-state', listener) }
  },
  clearVectors: () => {
    return ipcRenderer.invoke('clear-vectors')
  },
  
  // ── AI Methods ──────────────────────────────────────────────────────
  aiChat: (prompt: string, contextChats?: any[], history?: any[], mentions?: any[], options?: any) => {
    return ipcRenderer.invoke('ai-chat', prompt, contextChats, history, mentions, options)
  },
  aiChatStream: (prompt: string, contextChats: any[] | undefined, history: any[] | undefined, mentions: any[] | undefined, options: any | undefined, onChunk: (chunk: string) => void, onEnd: () => void, onError: (err: any) => void) => {
    const channelId = `ai-chat-${Date.now()}`;
    const chunkListener = (_event: any, chunk: string) => onChunk(chunk);
    const endListener = () => {
      ipcRenderer.removeListener(`${channelId}-chunk`, chunkListener);
      ipcRenderer.removeListener(`${channelId}-end`, endListener);
      ipcRenderer.removeListener(`${channelId}-error`, errorListener);
      onEnd();
    };
    const errorListener = (_event: any, err: any) => {
      ipcRenderer.removeListener(`${channelId}-chunk`, chunkListener);
      ipcRenderer.removeListener(`${channelId}-end`, endListener);
      ipcRenderer.removeListener(`${channelId}-error`, errorListener);
      onError(err);
    };

    ipcRenderer.on(`${channelId}-chunk`, chunkListener);
    ipcRenderer.on(`${channelId}-end`, endListener);
    ipcRenderer.on(`${channelId}-error`, errorListener);

    ipcRenderer.send('ai-chat-stream', { channelId, prompt, contextChats, history, mentions, options });
  },

  getChatContext: (jid: string) => {
    return ipcRenderer.invoke('get-chat-context', jid)
  },
  executeTool: (toolName: string, args: any) => {
    return ipcRenderer.invoke('execute-tool', toolName, args)
  },
  getAiTools: () => {
    return ipcRenderer.invoke('get-ai-tools')
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
