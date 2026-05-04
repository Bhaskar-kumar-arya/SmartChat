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
  profilePictureUrl?: string | null
}

interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  timestamp: string
  messageType: string
  textContent: string | null
  isDeleted?: boolean
  isEdited?: boolean
}

interface SearchResultItem {
  type: 'chat' | 'message'
  jid: string
  name: string
  lastMessage?: string
  messageId?: string
  snippet?: string
  timestamp?: string
  score?: number
}

interface SearchResults {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // Phase 1 & 2
      onWaQr: (callback: (qr: string) => void) => () => void
      onWaConnected: (callback: () => void) => () => void
      onWaLoggedOut: (callback: () => void) => () => void
      onWaSyncProgress: (callback: (progress: number) => void) => () => void
      onWaSyncComplete: (callback: () => void) => () => void
      skipSync: () => void
      // Phase 3 & 4
      getChats: (page?: number, pageSize?: number) => Promise<ChatItem[]>
      getMessages: (jid: string, page?: number, pageSize?: number) => Promise<MessageItem[]>
      sendMessage: (jid: string, text: string, quotedMsgId?: string, mentions?: string[]) => Promise<MessageItem>
      editMessage: (jid: string, messageId: string, newText: string) => Promise<MessageItem>
      deleteMessage: (jid: string, messageId: string) => Promise<boolean>
      sendMediaMessage: (jid: string, filePath: string, caption?: string, quotedMsgId?: string, mentions?: string[]) => Promise<MessageItem>
      getGroupParticipants: (jid: string) => Promise<{ jid: string, name: string, isAdmin: boolean, isMe: boolean }[]>
      downloadMedia: (msgId: string) => Promise<MessageItem>
      selectFile: () => Promise<string | null>
      onNewMessage: (callback: (msg: MessageItem) => void) => () => void
      onMessageEdited: (callback: (msg: MessageItem) => void) => () => void
      onMessageDeleted: (callback: (update: { id: string, remoteJid: string, fromMe: boolean }) => void) => () => void
      markRead: (jid: string) => Promise<boolean>
      onChatUpdated: (callback: (chat: Partial<ChatItem> & { jid: string }) => void) => () => void
      logout: () => Promise<boolean>
      onPresenceUpdate: (callback: (update: { remoteJid: string; presences: Record<string, any> }) => void) => () => void
      openFile: (localURI: string) => Promise<boolean>
      getProfilePicture: (jid: string, type: 'preview' | 'image', forceRefresh?: boolean) => Promise<string | null>
      saveTempFile: (buffer: ArrayBuffer | Uint8Array, fileName: string) => Promise<string>
      searchAll: (query: string, mode?: 'normal' | 'deep', filters?: any) => Promise<SearchResults>
      indexEmbeddings: () => Promise<void>
      onEmbeddingProgress: (callback: (pct: number) => void) => () => void
      onEmbeddingState: (callback: (isActive: boolean) => void) => () => void
      clearVectors: () => Promise<void>
      aiChat: (prompt: string, contextChats?: any[], history?: any[], mentions?: any[], options?: any) => Promise<string>
      aiChatStream: (prompt: string, contextChats: any[] | undefined, history: any[] | undefined, mentions: any[] | undefined, options: any | undefined, onChunk: (chunk: string) => void, onEnd: () => void, onError: (err: any) => void) => string
      abortAiChat: (channelId: string) => Promise<boolean>

      getChatContext: (jid: string) => Promise<MessageItem[]>
      executeTool: (toolName: string, args: any) => Promise<any>
      getAiTools: () => Promise<any[]>
      getAiModels: () => Promise<any[]>
  
      // ── AI Session Methods ──────────────────────────────────────────────
      createAiSession: (title: string, modelId?: string) => Promise<any>
      listAiSessions: (page?: number, pageSize?: number) => Promise<any[]>
      getAiSession: (id: string) => Promise<any>
      renameAiSession: (id: string, title: string) => Promise<any>
      deleteAiSession: (id: string) => Promise<void>
      saveAiSessionMessages: (sessionId: string, messages: any[]) => Promise<void>
      getAiAutoSave: () => Promise<boolean>
      setAiAutoSave: (enabled: boolean) => Promise<void>
    }
  }
}
