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

export interface AIContextItem {
  jid: string
  name: string
  messages: MessageItem[]
}

export interface JPEGThumbnailBuffer {
  type: 'Buffer'
  data: number[]
}

export type JPEGThumbnail = string | JPEGThumbnailBuffer | Uint8Array

export interface ContextInfo {
  quotedMessage?: RawMessageContent
  participant?: string
  participantName?: string
  mentions?: Record<string, string> | string[]
}

export interface ImageMessageContent {
  jpegThumbnail?: JPEGThumbnail
  width?: number
  height?: number
  fileLength?: number | string
  localURI?: string
  mimetype?: string
  caption?: string
  contextInfo?: ContextInfo
}

export interface VideoMessageContent {
  jpegThumbnail?: JPEGThumbnail
  width?: number
  height?: number
  fileLength?: number | string
  seconds?: number
  localURI?: string
  mimetype?: string
  gifPlayback?: boolean
  contextInfo?: ContextInfo
}

export interface DocumentMessageContent {
  fileName?: string
  fileLength?: number | string
  mimetype?: string
  localURI?: string
  contextInfo?: ContextInfo
}

export interface AudioMessageContent {
  seconds?: number
  mimetype?: string
  localURI?: string
  ptt?: boolean
  waveform?: Uint8Array | number[]
  contextInfo?: ContextInfo
}

export interface StickerMessageContent {
  localURI?: string
  mimetype?: string
  jpegThumbnail?: JPEGThumbnail
  contextInfo?: ContextInfo
}

export interface HydratedButton {
  quickReplyButton?: {
    displayText?: string
    id?: string
  }
  urlButton?: {
    displayText?: string
    url?: string
  }
  callButton?: {
    displayText?: string
    phoneNumber?: string
  }
}

export interface InteractiveButton {
  name: string
  buttonParamsJson?: string
}

export interface HydratedTemplate {
  hydratedContentText?: string
  hydratedFooterText?: string
  imageMessage?: ImageMessageContent
  videoMessage?: VideoMessageContent
  documentMessage?: DocumentMessageContent
  hydratedButtons?: HydratedButton[]
}

export interface InteractiveMessageTemplate {
  body?: {
    text?: string
  }
  footer?: {
    text?: string
  }
  header?: {
    title?: string
    text?: string
    imageMessage?: ImageMessageContent
    videoMessage?: VideoMessageContent
    documentMessage?: DocumentMessageContent
  }
  nativeFlowMessage?: {
    buttons?: InteractiveButton[]
  }
}

export interface TemplateMessageContent {
  hydratedFourRowTemplate?: HydratedTemplate
  hydratedTemplate?: HydratedTemplate
  interactiveMessageTemplate?: InteractiveMessageTemplate
}

export interface RawMessageContent {
  conversation?: string
  extendedTextMessage?: {
    text?: string
    contextInfo?: ContextInfo
  }
  imageMessage?: ImageMessageContent
  videoMessage?: VideoMessageContent
  ptvMessage?: VideoMessageContent
  documentMessage?: DocumentMessageContent
  audioMessage?: AudioMessageContent
  stickerMessage?: StickerMessageContent
  lottieStickerMessage?: any
  templateMessage?: TemplateMessageContent
  contextInfo?: ContextInfo
}

export interface AIChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  contexts?: AIContextItem[]
  mentions?: SelectedContext[]
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
  argumentsSchema?: Record<string, any>
  requiresPermission?: boolean
}

export interface ImageMessageProps {
  localURI?: string
  textContent?: string | null
  rawMsg: RawMessageContent
  onDownload?: () => void
  isDownloading: boolean
}

export interface StickerMessageProps {
  localURI?: string
  rawMsg: RawMessageContent
  onDownload?: () => void
  isDownloading: boolean
}

export interface VideoMessageProps {
  localURI?: string
  textContent?: string | null
  rawMsg: RawMessageContent
  onDownload?: () => void
  isDownloading: boolean
}

export interface DocumentMessageProps {
  localURI?: string
  textContent?: string | null
  rawMsg: RawMessageContent
  onDownload?: () => void
  isDownloading: boolean
}

export interface TemplateMessageProps {
  msg: MessageItem
  rawMsg: RawMessageContent
  localURI?: string
  onDownload: () => void
  isDownloading: boolean
}

export interface AudioMessageProps {
  localURI?: string
  textContent?: string | null
  senderJid?: string
  onDownload: () => void
  isDownloading: boolean
  rawMsg?: RawMessageContent
}

export interface TextMessageProps {
  text: string
  mentions?: Record<string, string> | string[]
}

export function isJPEGThumbnailBuffer(thumb: any): thumb is JPEGThumbnailBuffer {
  return thumb && typeof thumb === 'object' && thumb.type === 'Buffer' && Array.isArray(thumb.data)
}


