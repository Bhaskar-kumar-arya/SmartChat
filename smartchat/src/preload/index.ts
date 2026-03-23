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
    const listener = (_event: any, msg: any) => callback(msg)
    ipcRenderer.on('new-message', listener)
    return () => { ipcRenderer.removeListener('new-message', listener) }
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
  getProfilePicture: (jid: string, type: 'preview' | 'image') => {
    return ipcRenderer.invoke('get-profile-picture', jid, type)
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
