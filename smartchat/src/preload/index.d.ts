import { ElectronAPI } from '@electron-toolkit/preload'

interface ChatItem {
  jid: string
  name: string
  unreadCount: number
  timestamp: string
  lastMessage: string
  lastMessageTimestamp: string
  pinned?: number
  muteExpiration?: string
}

interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  timestamp: string
  messageType: string
  textContent: string | null
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // Phase 1 & 2
      onWaQr: (callback: (qr: string) => void) => void
      onWaConnected: (callback: () => void) => void
      onWaLoggedOut: (callback: () => void) => void
      onWaSyncProgress: (callback: (progress: number) => void) => void
      onWaSyncComplete: (callback: () => void) => void
      skipSync: () => void
      // Phase 3 & 4
      getChats: (page?: number, pageSize?: number) => Promise<ChatItem[]>
      getMessages: (jid: string, page?: number, pageSize?: number) => Promise<MessageItem[]>
      sendMessage: (jid: string, text: string) => Promise<MessageItem>
      onNewMessage: (callback: (msg: MessageItem) => void) => void
      markRead: (jid: string) => Promise<boolean>
      onChatUpdated: (callback: (chat: Partial<ChatItem> & { jid: string }) => void) => void
      logout: () => Promise<boolean>
    }
  }
}
