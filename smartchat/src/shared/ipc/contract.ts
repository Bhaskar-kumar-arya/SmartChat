/**
 * The typed IPC contract (C-01, types only). One entry per channel that exists
 * today; where the handler, preload and `index.d.ts` disagreed, the entry
 * encodes the HANDLER truth (the mismatch is listed in the C-01 report and is
 * fixed by C-03/C-04, not here).
 *
 *  - `InvokeMap`: `ipcRenderer.invoke` -> `ipcMain.handle` (args after the event, result).
 *  - `SendMap`:   `ipcRenderer.send`   -> `ipcMain.on`     (fire-and-forget, args only).
 *  - `EventMap`:  main/webContents `.send` -> `ipcRenderer.on` (payload tuple).
 *
 * Channel keys must stay one-per-line (`  'name': {`): the drift test in
 * `src/main/tests/ipc/ipcContract.test.ts` parses them from this file.
 * Dynamic per-stream channels (`${channelId}-chunk|-end|-error`) are typed by
 * {@link AiStreamEventMap}, not listed in `EventMap`.
 */
import type { ModalRequest, WebviewOverlayRequest } from '../../main/kernel/ui/IOverlayHost'
import type {
  AIChatMessage,
  AIChatOptions,
  AIChatSessionItem,
  AIContextItem,
  CitationEntity,
  ChatListItem,
  EnrichedMessage,
  ExecuteContributionOpts,
  ExtensionChatMessage,
  ExtensionManifest,
  FavoriteStickerDto,
  GetMessagesOptions,
  GroupParticipant,
  LoadedExtension,
  MentionResult,
  MessageReceiptInfo,
  ModelInfo,
  NotificationPreferences,
  PresenceUpdate,
  ReactMessageResult,
  SearchFilters,
  SearchMode,
  SearchResults,
  SelectedContext,
  ToolDefinition,
  ToolResult,
  ContributionRegistrySnapshot
} from './dto'

export type AiChatCallOptions = Partial<AIChatOptions> & {
  isSystem?: boolean
  requestId?: string
}

export type SyncStatus = 'success' | 'deferred' | 'error'

export interface SyncProgress {
  progress: number
  syncType: number
  syncFullHistory: boolean
}

export interface HistoryAppended {
  messageCount: number
  jid?: string
  requestId?: string
  error?: string
}

export interface PluginResultError {
  code?: string
  message?: string
}

export type PanelApiResult<T = unknown> =
  | { ok: true; payload?: T }
  | { ok: false; error: PluginResultError }

export interface ExtensionOpResult {
  success: boolean
}

export interface InvokeMap {
  // ── Chats & messages ────────────────────────────────────────────────
  'get-chats': { args: [page?: number, pageSize?: number]; result: ChatListItem[] }
  'get-chat': { args: [jid: string]; result: ChatListItem | null }
  'get-messages': { args: [jid: string, options?: GetMessagesOptions]; result: EnrichedMessage[] }
  'get-messages-around': { args: [jid: string, messageId: string, lookBehind?: number]; result: EnrichedMessage[] }
  'send-message': { args: [jid: string, text: string, quotedMsgId?: string, mentions?: string[]]; result: EnrichedMessage }
  'edit-message': { args: [jid: string, messageId: string, newText: string]; result: EnrichedMessage }
  'retry-message': { args: [jid: string, messageId: string]; result: EnrichedMessage }
  'delete-message': { args: [jid: string, messageId: string]; result: true }
  'react-message': { args: [jid: string, messageId: string, reaction: string]; result: ReactMessageResult }
  'send-media-message': {
    args: [jid: string, filePath: string, caption?: string, quotedMsgId?: string, mentions?: string[]]
    result: EnrichedMessage
  }
  'mark-read': { args: [jid: string]; result: boolean }
  'mute-chat': { args: [jid: string, durationMs: number]; result: true }
  'unmute-chat': { args: [jid: string]; result: true }
  'pin-chat': { args: [jid: string]; result: true }
  'unpin-chat': { args: [jid: string]; result: true }
  'get-message-receipts': { args: [messageId: string]; result: MessageReceiptInfo[] }
  'get-group-participants': { args: [jid: string]; result: GroupParticipant[] }

  // ── Media & files ───────────────────────────────────────────────────
  'save-temp-file': { args: [buffer: ArrayBuffer | Uint8Array, fileName: string]; result: string }
  'download-url-to-temp': { args: [url: string, fileName: string]; result: string }
  'select-file': { args: []; result: string[] | null }
  'download-media': { args: [msgId: string]; result: EnrichedMessage }
  'open-file': { args: [localURI: string]; result: boolean }

  // ── Stickers ────────────────────────────────────────────────────────
  'add-sticker-to-favorites': { args: [msgId: string]; result: boolean }
  'remove-sticker-from-favorites': { args: [msgId: string]; result: boolean }
  'remove-favorite-sticker-by-id': { args: [id: string]; result: boolean }
  'is-sticker-favorite': { args: [msgId: string]; result: boolean }
  'get-favorite-stickers': { args: []; result: FavoriteStickerDto[] }

  // ── Auth, profile & sync ────────────────────────────────────────────
  'get-my-jid': { args: []; result: string | null }
  logout: { args: []; result: true }
  'get-profile-picture': { args: [jid: string, type: 'preview' | 'image', forceRefresh?: boolean]; result: string | null }
  'get-sync-full-history': { args: []; result: boolean }
  'set-sync-full-history': { args: [full: boolean]; result: true }
  'wa-skip-sync': { args: []; result: { status: SyncStatus } }
  'wa:fetch-message-history': { args: [jid: string]; result: { status: 'requested' | 'no-anchor' | 'error' } }

  // ── Search & vectors ────────────────────────────────────────────────
  'search-all': { args: [query: string, mode?: SearchMode, filters?: SearchFilters]; result: SearchResults }
  'search-mention-contacts': { args: [query: string]; result: MentionResult[] }
  'search-mention-chats': { args: [query: string]; result: MentionResult[] }
  'index-embeddings': { args: []; result: void }
  'clear-vectors': { args: []; result: void }

  // ── AI ──────────────────────────────────────────────────────────────
  'execute-tool': { args: [toolName: string, args: Record<string, unknown> | undefined, sessionId?: string | null]; result: ToolResult }
  'get-ai-tools': { args: []; result: Pick<ToolDefinition, 'name' | 'description' | 'requiresPermission'>[] }
  'ai-chat': {
    args: [prompt: string, contextChats?: AIContextItem[], history?: AIChatMessage[], mentions?: SelectedContext[], options?: AiChatCallOptions]
    result: string
  }
  'get-ai-models': { args: []; result: ModelInfo[] }
  'get-provider-keys': { args: []; result: Record<string, string> }
  'set-provider-key': { args: [provider: string, key: string]; result: boolean }
  'abort-ai-chat': { args: [channelId: string]; result: true }
  'get-chat-context': { args: [jid: string]; result: EnrichedMessage[] }
  'ai-session-create': { args: [title: string, modelId?: string]; result: AIChatSessionItem }
  'ai-session-list': { args: [page?: number, pageSize?: number]; result: AIChatSessionItem[] }
  'ai-session-get': { args: [id: string]; result: { id: string; title: string; messages: AIChatMessage[] } | null }
  'ai-session-rename': { args: [id: string, title: string]; result: unknown }
  'ai-session-delete': { args: [id: string]; result: void }
  'ai-session-clone': { args: [id: string]; result: AIChatSessionItem }
  'ai-session-save-messages': { args: [sessionId: string, messages: AIChatMessage[]]; result: void }
  'ai-session-get-autosave': { args: []; result: boolean }
  'ai-session-set-autosave': { args: [enabled: boolean]; result: void }
  'get-ai-options': { args: []; result: AIChatOptions }
  'set-ai-options': { args: [options: Record<string, unknown>]; result: void }
  'export-ai-chat': { args: [session: AIChatSessionItem, messages: AIChatMessage[]]; result: void }
  'delete-exported-ai-chat': { args: [sessionId: string]; result: void }
  'duplicate-exported-ai-chat': { args: [sessionId: string]; result: void }
  'citation:resolve': { args: [sessionId: string, citationIndex: number]; result: CitationEntity | null }
  'citation:resolveAll': { args: [sessionId: string]; result: ReadonlyMap<number, CitationEntity> }

  // ── Notifications ───────────────────────────────────────────────────
  'get-notification-preferences': { args: []; result: NotificationPreferences }
  'set-notification-preferences': { args: [prefs: Partial<NotificationPreferences>]; result: void }
  'set-active-chat': { args: [jid: string | null]; result: void }

  // ── Extensions & kernel ─────────────────────────────────────────────
  'extension:list': { args: []; result: LoadedExtension[] }
  'extension:install': { args: [scextPath: string]; result: ExtensionOpResult & { manifest: ExtensionManifest } }
  'extension:unload': { args: [id: string]; result: ExtensionOpResult }
  'extension:reload': { args: [id: string]; result: ExtensionOpResult }
  'extension:uninstall': { args: [id: string]; result: ExtensionOpResult }
  'extension:get-log': { args: [id: string]; result: unknown[] }
  // Preload-only today: no main handler (B-APP-02, removed by C-04). Typed from the preload/index.d.ts.
  'extension:get-docs': { args: []; result: string }
  'extension:chat-history': { args: [extensionId: string, limit?: number]; result: ExtensionChatMessage[] }
  'kernel:contributions:snapshot': { args: []; result: ContributionRegistrySnapshot }
  'kernel:contribution:execute': { args: [opts: ExecuteContributionOpts]; result: void }
  'kernel:ui:modal:resolve': { args: [opts: { modalId: string; data: unknown }]; result: void }
  'kernel:panel:api': { args: [req: { panelId: string; type: string; payload?: unknown }]; result: PanelApiResult }
  'kernel:panel:events:subscribe': { args: [req: { panelId: string; eventName: string }]; result: PanelApiResult<never> }
}

export interface SendMap {
  'ai-chat-stream': {
    args: [
      req: {
        channelId: string
        prompt: string
        contextChats?: AIContextItem[]
        history?: AIChatMessage[]
        mentions?: SelectedContext[]
        options?: AiChatCallOptions
      }
    ]
  }
  'grant-local-file-preview': { args: [filePath: string] }
  ping: { args: [] }
  // Preload-only today: no main listener (B-APP-02, removed by C-04).
  'extension:chat-send': { args: [extensionId: string, text: string] }
  'kernel:ui:overlay:submit': { args: [opts: { overlayId: string; data: unknown }] }
  'kernel:ui:overlay:event': { args: [opts: { overlayId: string; event: string; data: unknown }] }
  'kernel:ui:overlay:dismiss': { args: [opts: { overlayId: string }] }
  'kernel:panel:closed': { args: [req: { panelId: string }] }
  'kernel:panel:events:unsubscribe': { args: [req: { panelId: string; eventName: string }] }
}

export interface EventMap {
  'wa-qr': [qr: string]
  'wa-connected': [data?: { isCatchup?: boolean }]
  'wa-logged-out': []
  'wa-session-replaced': []
  'wa-disconnected': [data: { code?: number }]
  'wa-sync-progress': [data: SyncProgress]
  'wa-sync-status': [status: string]
  'wa-sync-complete': []
  'wa-history-appended': [data: HistoryAppended]
  'new-message': [msg: EnrichedMessage]
  'message-edited': [msg: EnrichedMessage]
  'message-deleted': [update: { id: string; chatJid: string; fromMe: boolean }]
  'message-status-updated': [update: { id: string; chatJid: string; status: string }]
  'chat-updated': [chat: Partial<ChatListItem> & { jid: string }]
  'presence-update': [update: PresenceUpdate]
  'embedding-progress': [pct: number]
  'embedding-state': [isActive: boolean]
  'open-chat': [chat: { jid: string; name: string }]
  toast: [data: { message: string; level: 'info' | 'success' | 'warning' | 'error'; pluginId: string }]
  // Preload listens but main never emits today (B-APP-02, removed by C-04).
  'extension:chat-push': [payload: { extensionId: string; message: ExtensionChatMessage }]
  'extension:focus': [id: string]
  'kernel:contributions:updated': [snapshot: ContributionRegistrySnapshot]
  'kernel:ui:modal:show': [req: ModalRequest]
  'kernel:ui:overlay:show': [req: WebviewOverlayRequest]
  'kernel:ui:overlay:incoming': [data: { overlayId: string; event: string; data: unknown }]
  'kernel:ui:overlay:close': [data: { overlayId: string }]
  'kernel:ui:panel:open': [data: { contributionId: string; pluginId: string; panelId: string }]
  'kernel:ui:panel:close': [data: { contributionId: string; pluginId: string }]
  'smartchat:event': [msg: { event: string; payload: unknown }]
}

/** Per-stream `ai-chat-stream` replies, sent on `${channelId}-chunk|-end|-error`. */
export interface AiStreamEventMap {
  chunk: [chunk: string]
  end: []
  /** Main sends the error MESSAGE (a string); preload/IAPIService type it as `Error` (M4). */
  error: [message: string]
}

export type InvokeChannel = keyof InvokeMap
export type SendChannel = keyof SendMap
export type EventChannel = keyof EventMap
export type InvokeArgs<K extends InvokeChannel> = InvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = InvokeMap[K]['result']
