export interface ChatItem {
  jid: string
  name: string
  unreadCount: number
  timestamp: string
  lastMessage: string
  lastMessageType?: string | null
  lastMessageTimestamp: string
  pinned?: number
  muteExpiration?: string
  profilePictureUrl?: string | null
  isCommunity?: boolean
  isAnnounce?: boolean
  linkedParentJid?: string | null
  pushName?: string | null
  verifiedName?: string | null
  phoneNumber?: string | null
}

export interface SelectedContext {
  jid: string
  name: string
}


export interface ExtendedChatItem extends ChatItem {
  isChild?: boolean
  parentName?: string
  totalUnreadCount?: number
  children?: ChatItem[]
}

export interface ReactionItem {
  senderId: string
  senderName?: string | null
  text: string
  timestamp: string
}

export interface MessageItem {
  id: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  participantName?: string | null
  timestamp: string
  messageType: string
  textContent: string | null
  content?: string
  localURI?: string
  reactions?: ReactionItem[]
  isDeleted?: boolean
  isEdited?: boolean
  status?: string
}

export interface MessageReceiptInfo {
  userJid: string
  name: string
  status: string
  timestamp: string
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

export interface ModelInfo {
  id: string
  name: string
  provider: 'gemini' | 'lmstudio' | 'groq' | 'mistral' | 'deepseek'
  description?: string
  isLocal: boolean
}

export interface AIChatOptions {
  useThinkMode: boolean
  model: string
  contextLength: number
  autoSaveChats: boolean
}

export interface AIChatSessionItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId?: string
}

export interface AIChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  contexts?: any[]
  mentions?: any[]
  isHidden?: boolean
  isSystem?: boolean
  toolResult?: string
  hasError?: boolean
}

export interface PresenceEntry {
  lastKnownPresence: 'composing' | 'recording' | 'available' | 'unavailable' | string
  timestamp: number
  name?: string
}

export type PresenceMap = Record<string, PresenceEntry>

export interface PresenceUpdate {
  remoteJid: string
  presences: PresenceMap
}

export interface GroupParticipant {
  jid: string
  name: string
  isAdmin: boolean
  isMe: boolean
}

export interface ToolDefinition {
  name: string
  description?: string
  argumentsSchema?: any
  requiresPermission?: boolean
}

