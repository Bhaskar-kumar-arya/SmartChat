import { PluginManifest } from './manifest'
import { PluginEventMap, PluginEventName } from './events'

export interface PluginChatItem {
  jid: string
  name?: string
  unreadCount?: number
  isArchived?: boolean
  isPinned?: boolean
  isMuted?: boolean
  lastMessageTimestamp?: number
}

export interface PluginMessageItem {
  id: string
  chatJid: string
  senderJid: string
  fromMe: boolean
  text: string | null
  timestamp: number
}

export interface PluginContactItem {
  jid: string
  name?: string
  pushName?: string
}

export interface SendMessageOptions {
  quotedMessageId?: string
}

export interface AICallOptions {
  temperature?: number
  model?: string
}

export interface ChatActionContext {
  chatJid: string
}

export interface MessageActionContext {
  chatJid: string
  messageId: string
}

export interface CommandContext {
  chatJid?: string
}

/**
 * Flat context object passed to evaluateWhen for chat-action contributions.
 * All keys match WhenLeaf.field values used in `when` conditions.
 */
export interface ChatWhenContext {
  'chat.type': 'DM' | 'GROUP' | 'COMMUNITY' | 'ANNOUNCE' | 'SUBGROUP'
  'chat.unreadCount': number
  'chat.isPinned': boolean
  'chat.isMuted': boolean
  'chat.isAnnounce': boolean
  'chat.isCommunity': boolean
}

/**
 * Flat context object passed to evaluateWhen for message-action contributions.
 * All keys match WhenLeaf.field values used in `when` conditions.
 */
export interface MessageWhenContext {
  'message.messageType': string
  'message.fromMe': boolean
  'message.isDeleted': boolean
  'message.isEdited': boolean
  'message.isMedia': boolean
  'message.isText': boolean
  'message.hasReactions': boolean
}

export interface BadgeDescriptor {
  text?: string
  count?: number
  color?: string
}

export interface CompletionContext {
  text: string
  cursorPosition: number
}

export interface CompletionItem {
  label: string
  insertText: string
  detail?: string
}

export interface OutgoingMessagePayload {
  chatJid: string
  text: string
}

export interface SendResult {
  success: boolean
  messageId?: string
}

export interface IPluginLogAPI {
  info(msg: string, ...data: unknown[]): void
  warn(msg: string, ...data: unknown[]): void
  error(msg: string, ...data: unknown[]): void
}

export interface PluginGroupParticipant {
  jid: string
  name: string
  isAdmin: boolean
  isMe: boolean
}

export interface IPluginChatsAPI {
  getList(page?: number, limit?: number): Promise<PluginChatItem[]>
  getById(jid: string): Promise<PluginChatItem | null>
  getGroupParticipants(jid: string): Promise<PluginGroupParticipant[]>
  pin(jid: string): Promise<void>
  unpin(jid: string): Promise<void>
  archive(jid: string): Promise<void>
  unarchive(jid: string): Promise<void>
  mute(jid: string, durationMs: number): Promise<void>
  unmute(jid: string): Promise<void>
  markRead(jid: string): Promise<void>
}

export interface PluginReceiptItem {
  userJid: string
  status?: string | number
  timestamp?: number | string
  readTimestamp?: number
  deliveredTimestamp?: number
}

export interface PluginFavoriteStickerItem {
  id: string
  fileSha256: string
  fileName: string
  localURI: string
  createdAt: number
}

export interface IPluginMessagesAPI {
  getMessages(jid: string, page?: number, limit?: number): Promise<PluginMessageItem[]>
  getMessagesAroundId(jid: string, messageId: string, lookBehind?: number): Promise<PluginMessageItem[]>
  send(jid: string, text: string, options?: SendMessageOptions): Promise<PluginMessageItem>
  sendMedia(jid: string, filePath: string, caption?: string, options?: SendMessageOptions): Promise<PluginMessageItem>
  edit(messageId: string, newText: string, jid?: string): Promise<PluginMessageItem>
  forward(messageId: string, targetJids: string[], jid?: string): Promise<{ success: boolean; detail: string; results: Array<{ jid: string; messageId: string }> }>
  delete(jid: string, messageId: string): Promise<void>
  react(jid: string, messageId: string, emoji: string): Promise<void>
  downloadMedia(messageId: string): Promise<{ success: boolean; localURI?: string; filePath?: string; message?: unknown }>
  getReceipts(messageId: string): Promise<PluginReceiptItem[]>
  addFavoriteSticker(messageId: string): Promise<{ success: boolean }>
  getFavoriteStickers(): Promise<PluginFavoriteStickerItem[]>
}

export interface PluginMeInfo {
  jids: string[]
  phoneNumberJid: string | null
}

export interface PluginContactInput {
  id: string
  lid?: string | null
  phoneNumber?: string | null
  name?: string | null
  notify?: string | null
  pushName?: string | null
}

export interface PluginAliasItem {
  id?: number
  jid: string
  type: string
  identityId: number
}

export interface IPluginContactsAPI {
  getByJid(jid: string): Promise<PluginContactItem | null>
  batchGetByJids(jids: string[]): Promise<PluginContactItem[]>
  getMe(): Promise<PluginMeInfo>
  upsertContact(contact: PluginContactInput): Promise<{ success: boolean }>
  resolveLid(jid: string): Promise<{ jid: string; lid: string }>
  getAlias(jid: string): Promise<PluginAliasItem | null>
}

export interface IPluginEventsAPI {
  on<K extends PluginEventName>(
    event: K,
    handler: (payload: PluginEventMap[K]) => void | Promise<void>
  ): () => void
}

export interface IPluginStorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}

export interface IPluginSchedulerAPI {
  setInterval(ms: number, fn: () => void | Promise<void>): () => void
  setTimeout(ms: number, fn: () => void | Promise<void>): () => void
  onCron(name: string, fn: () => void | Promise<void>): void
}

export interface IPluginUIAPI {
  notify(opts: { title: string; body: string }): Promise<void>
  toast(msg: string, level?: 'info' | 'success' | 'warning' | 'error'): void
}

export interface PluginAIModelInfo {
  id: string
  name: string
  provider: string
  description?: string
}

export interface PluginAISession {
  id: string
  title: string
  modelId?: string | null
  createdAt?: number | string
  updatedAt?: number | string
  messages?: unknown[]
}

export interface IPluginAIAPI {
  chat(prompt: string, options?: AICallOptions): Promise<string>
  callTool(toolName: string, args: Record<string, unknown>): Promise<{ text: string }>
  getAvailableModels(): Promise<PluginAIModelInfo[]>
  createSession(title: string, modelId?: string): Promise<PluginAISession>
  listSessions(page?: number, pageSize?: number): Promise<PluginAISession[]>
  getSession(id: string): Promise<PluginAISession | null>
  renameSession(id: string, title: string): Promise<PluginAISession>
  deleteSession(id: string): Promise<void>
}

export interface IPluginContributionsAPI {
  registerChatAction?(
    id: string,
    handler: (ctx: ChatActionContext) => Promise<void>
  ): void
  registerMessageAction?(
    id: string,
    handler: (ctx: MessageActionContext) => Promise<void>
  ): void
  registerChatBadge?(
    id: string,
    compute: (chatJid: string) => Promise<BadgeDescriptor | null>
  ): void
  registerSlashCommand?(
    name: string,
    handler: (args: string, context: CommandContext) => Promise<void>
  ): void
  registerAITool?(
    name: string,
    execute: (args: Record<string, unknown>) => Promise<{ text: string }>
  ): void
  registerCompletionProvider?(
    id: string,
    provide: (ctx: CompletionContext) => Promise<CompletionItem[]>
  ): void
  registerMessageSendInterceptor?(
    id: string,
    intercept: (
      payload: OutgoingMessagePayload,
      next: (payload: OutgoingMessagePayload) => Promise<SendResult>
    ) => Promise<SendResult>
  ): void
  registerSidebarPanel?(id: string, opts: { title: string; icon?: string; panel?: string }): void
  registerSettingsPage?(id: string, opts: { title: string; panel?: string }): void
  registerMessageRenderer?(id: string, opts: { messageType: string; panel?: string }): void
  exposeAPI?(exportName: string, api: Record<string, unknown>): void
  importAPI?(pluginId: string, exportName: string): Promise<Record<string, unknown>>
}

export interface PluginContext {
  readonly id: string
  readonly manifest: PluginManifest

  onActivate(fn: () => Promise<void>): void
  onDeactivate(fn: () => Promise<void>): void

  readonly log: IPluginLogAPI
  readonly chats?: IPluginChatsAPI
  readonly messages?: IPluginMessagesAPI
  readonly contacts?: IPluginContactsAPI
  readonly ai?: IPluginAIAPI
  readonly events?: IPluginEventsAPI
  readonly storage?: IPluginStorageAPI
  readonly ui?: IPluginUIAPI
  readonly scheduler?: IPluginSchedulerAPI
  readonly contributions: IPluginContributionsAPI
}
