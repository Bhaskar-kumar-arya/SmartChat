import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // ── Phase 1 & 2: Auth & Sync ──────────────────────────────────────
  onWaQr: (callback: (qr: string) => void) => {
    ipcRenderer.on('wa-qr', (_event, qr) => callback(qr))
  },
  onWaConnected: (callback: () => void) => {
    ipcRenderer.on('wa-connected', () => callback())
  },
  onWaLoggedOut: (callback: () => void) => {
    ipcRenderer.on('wa-logged-out', () => callback())
  },
  onWaSyncProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('wa-sync-progress', (_event, progress) => callback(progress))
  },
  onWaSyncComplete: (callback: () => void) => {
    ipcRenderer.on('wa-sync-complete', () => callback())
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
  sendMessage: (jid: string, text: string, quotedMsgId?: string) => {
    return ipcRenderer.invoke('send-message', jid, text, quotedMsgId)
  },
  sendMediaMessage: (jid: string, filePath: string, caption?: string, quotedMsgId?: string) => {
    return ipcRenderer.invoke('send-media-message', jid, filePath, caption, quotedMsgId)
  },
  downloadMedia: (msgId: string) => {
    return ipcRenderer.invoke('download-media', msgId)
  },
  selectFile: () => {
    return ipcRenderer.invoke('select-file')
  },
  onNewMessage: (callback: (msg: Record<string, unknown>) => void) => {
    ipcRenderer.on('new-message', (_event, msg) => callback(msg))
  },
  markRead: (jid: string) => {
    return ipcRenderer.invoke('mark-read', jid)
  },
  onChatUpdated: (callback: (chat: Record<string, unknown>) => void) => {
    ipcRenderer.on('chat-updated', (_event, chat) => callback(chat))
  },
  logout: () => {
    return ipcRenderer.invoke('logout')
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
