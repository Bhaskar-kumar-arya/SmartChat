/**
 * Shared IPC DTOs (C-01). Types only: no runtime code, and nothing here may
 * import from `main/services` or the renderer. The old homes
 * (`main/ipc/*.types.ts`, `renderer/src/types/*`) re-export from here.
 */
import type { ContributionMap, ContributionSlot } from '../../main/kernel/contributions/ContributionPoints'

// ── Chats ───────────────────────────────────────────────────────────────

/** Chat list item as main returns it (`get-chats`, `get-chat`). */
export interface ChatListItem {
  jid: string
  name: string
  unreadCount: number
  timestamp: string
  lastMessage: string
  lastMessageType?: string | null
  lastMessageTimestamp: string
  pinned: number
  muteExpiration: string
  profilePictureUrl: string | null
  isCommunity: boolean
  isAnnounce: boolean
  linkedParentJid: string | null
  lastMessageSender?: string | null
  lastMessageStatus?: string | null
  lastMessageFromMe?: boolean
  lastMessageId?: string | null
  lastMessageTargetType?: string | null
  lastMessageTargetText?: string | null
  lastMessageReactionText?: string | null
  source?: 'whatsapp' | 'extension'
  extensionId?: string
  /**
   * True when this entry was pulled in only to complete a community grouping
   * (a root/sibling of a chat on the requested page) and does NOT belong to the
   * requested pagination window. Consumers must exclude these from end-of-list
   * ("did we get a full page?") accounting.
   */
  outOfWindow?: boolean
}

/** Renderer-side chat shape (looser than {@link ChatListItem}; kept for the renderer). */
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
  lastMessageSender?: string | null
  lastMessageStatus?: string | null
  lastMessageFromMe?: boolean
  lastMessageId?: string | null
  lastMessageTargetType?: string | null
  lastMessageTargetText?: string | null
  lastMessageReactionText?: string | null
  /**
   * Set when the backend pulled this chat in only to complete a community
   * grouping — it is outside the requested pagination window and must not count
   * toward "did we receive a full page?".
   */
  outOfWindow?: boolean
}

export interface SelectedContext {
  jid: string
  name: string
}

export interface GroupParticipant {
  jid: string
  name: string
  isAdmin: boolean
  isMe: boolean
}

// ── Messages ────────────────────────────────────────────────────────────

/** Enriched reaction for UI display. */
export interface EnrichedReaction {
  text: string
  senderId: string
  senderName: string
  timestamp: string
}

/** Enriched message returned by main over IPC. */
export interface EnrichedMessage {
  id: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  participantName: string
  timestamp: string
  messageType: string
  content: string
  reactions?: EnrichedReaction[]
  isDeleted?: boolean
  isEdited?: boolean
  status?: string | null
}

export interface ReactionItem {
  senderId: string
  senderName?: string | null
  text: string
  timestamp: string
}

/** Renderer-side message shape (differs from {@link EnrichedMessage}: `textContent`, `localURI`). */
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
  targetMessageType?: string
  targetTextContent?: string | null
}

export interface MessageReceiptInfo {
  userJid: string
  name: string
  status: string
  timestamp: string
}

export interface GetMessagesOptions {
  limit?: number
  before?: string
  after?: string
}

export interface ReactMessageResult {
  success: boolean
  detail: string
  messageId: string
  reaction: string
}

export interface FavoriteStickerDto {
  id: string
  fileSha256: string
  fileName: string
  localURI: string
  createdAt: number
}

// ── Presence / notifications / search ───────────────────────────────────

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

export interface NotificationPreferences {
  enabled: boolean
  soundEnabled: boolean
  notifyWhenFocused: boolean
  minimizeToTray: boolean
  launchOnStartup: boolean
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
  senderName?: string
}

export type SearchMode = 'normal' | 'deep'

export interface SearchFilters {
  jids?: string[]
  fromDate?: string // ISO string
  toDate?: string // ISO string
}

export interface SearchResults {
  chats: SearchResultItem[]
  messages: SearchResultItem[]
}

/** Result of `search-mention-contacts` / `search-mention-chats`. */
export interface MentionResult {
  jid: string
  name: string
  pushName?: string | null
  verifiedName?: string | null
  phoneNumber?: string | null
  profilePictureUrl?: string | null
}

// ── AI ──────────────────────────────────────────────────────────────────

export interface AIChatOptions {
  useThinkMode: boolean
  model: string
  contextLength: number
  autoSaveChats: boolean
}

export interface AIContextItem {
  jid: string
  name: string
  messages: MessageItem[]
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

export interface ModelInfo {
  id: string
  name: string
  provider: string
  description?: string
  isLocal: boolean
}

export interface AIChatSessionItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId?: string
}

export interface ToolDefinition {
  name: string
  description?: string
  argumentsSchema?: Record<string, any>
  requiresPermission?: boolean
}

/** Polymorphic discriminated union for all citation target types. */
export type CitationEntity =
  | { type: 'message'; chatJid: string; messageId: string }
  | { type: 'chat'; chatJid: string }
  | { type: 'file'; filePath: string }

export interface ToolResult {
  text: string
  citations?: ReadonlyMap<number, CitationEntity>
}

// ── Extensions / contributions ──────────────────────────────────────────

export interface SlashCommand {
  name: string
  description: string
}

export interface ExtensionManifest {
  id: string
  version: string
  name: string
  description: string
  permissions: string[]
  dedicatedChat?: {
    name: string
    avatarEmoji: string
    commands: SlashCommand[]
  }
}

export interface LoadedExtension {
  id: string
  manifest: ExtensionManifest
  isLoaded: boolean
  /** Why the extension failed to load, when it is installed but not loaded. */
  error?: string
}

export interface ExtensionChatMessage {
  id: string
  extensionId: string
  role: 'user' | 'extension'
  content: string // JSON string: { type, text?, title?, body?, buttons? }
  createdAt: string
}

export type { ContributionMap, ContributionSlot }

export type ContributionRegistrySnapshot = {
  [K in ContributionSlot]?: ContributionMap[K][]
} & {
  panelIds?: Record<string, string>
}

export interface ExecuteContributionOpts {
  slot: ContributionSlot
  pluginId: string
  id: string
  context?: Record<string, unknown>
}
