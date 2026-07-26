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

export interface IPluginChatsAPI {
  getList(page?: number, limit?: number): Promise<PluginChatItem[]>
  getById(jid: string): Promise<PluginChatItem | null>
  pin(jid: string): Promise<void>
  unpin(jid: string): Promise<void>
  archive(jid: string): Promise<void>
  unarchive(jid: string): Promise<void>
  mute(jid: string, durationMs: number): Promise<void>
  unmute(jid: string): Promise<void>
  markRead(jid: string): Promise<void>
}

export interface IPluginMessagesAPI {
  getMessages(jid: string, page?: number, limit?: number): Promise<PluginMessageItem[]>
  send(jid: string, text: string, options?: SendMessageOptions): Promise<PluginMessageItem>
  delete(jid: string, messageId: string): Promise<void>
  react(jid: string, messageId: string, emoji: string): Promise<void>
}

export interface IPluginContactsAPI {
  getByJid(jid: string): Promise<PluginContactItem | null>
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

export interface IPluginAIAPI {
  chat(prompt: string, options?: AICallOptions): Promise<string>
  callTool(toolName: string, args: Record<string, unknown>): Promise<{ text: string }>
}

export interface IPluginContributionsAPI {
  registerChatAction(
    id: string,
    handler: (ctx: ChatActionContext) => Promise<void>
  ): void
  registerMessageAction(
    id: string,
    handler: (ctx: MessageActionContext) => Promise<void>
  ): void
  registerChatBadge(
    id: string,
    compute: (chatJid: string) => Promise<BadgeDescriptor | null>
  ): void
  registerSlashCommand(
    name: string,
    handler: (args: string, context: CommandContext) => Promise<void>
  ): void
  registerAITool(
    name: string,
    execute: (args: Record<string, unknown>) => Promise<{ text: string }>
  ): void
  registerCompletionProvider(
    id: string,
    provide: (ctx: CompletionContext) => Promise<CompletionItem[]>
  ): void
  registerMessageSendInterceptor(
    id: string,
    intercept: (
      payload: OutgoingMessagePayload,
      next: (payload: OutgoingMessagePayload) => Promise<SendResult>
    ) => Promise<SendResult>
  ): void
  exposeAPI(exportName: string, api: Record<string, unknown>): void
  importAPI(pluginId: string, exportName: string): Promise<Record<string, unknown>>
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
