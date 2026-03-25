export interface ChatItem {
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

export interface ReactionItem {
  senderId: string
  senderName?: string | null
  text: string
  timestamp: string
}

export interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  participantName?: string | null
  timestamp: string
  messageType: string
  textContent: string | null
  content?: string
  localURI?: string
  reactions?: ReactionItem[]
}

export interface SearchResultItem {
  type: 'chat' | 'message'
  jid: string
  name: string
  lastMessage?: string
  messageId?: string
  snippet?: string
  timestamp?: string
  score?: number
}

export type SearchMode = 'normal' | 'deep'

export interface SearchFilters {
  jids?: string[]
  fromDate?: string // ISO string
  toDate?: string   // ISO string
}

export interface SearchResults {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
}

export interface PresenceUpdate {
  remoteJid: string
  presences: Record<string, {
    lastKnownPresence: 'composing' | 'recording' | 'available' | 'unavailable' | string
    timestamp: number
    name?: string
  }>
}
