/**
 * WAEventTypes
 * ============
 * Typed domain event interfaces for the WAEventBus pub/sub system.
 *
 * These are clean, parsed representations of raw Baileys events.
 * Subscribers receive these types — no raw Baileys payloads leak through.
 */

import {
  WASocket,
  ProcessedMessage,
  MessageReceiptUpdate,
  BaileysMessage,
  ChatUpdatePayload,
  BaileysContact,
  BaileysGroupUpdate,
  BaileysReactionUpdate,
  BaileysCall
} from '../../types'
import { proto } from '@whiskeysockets/baileys'

// ─── Message Events ───────────────────────────────────────────────────────────

/**
 * Fired for each real-time incoming message (Baileys type='notify').
 * Enrichment (name resolution, profile pic) happens inside the subscriber
 * that needs it, keeping the handler lean.
 */
export interface IncomingMessageEvent {
  chatJid: string
  senderJid: string
  messageType: string
  textContent: string | null
  fromMe: boolean
  timestamp: bigint
  processed: ProcessedMessage  // full processed row for subscribers that need detail
  sock: WASocket
}

/**
 * Fired for bulk backlog messages (Baileys type='append').
 * Fast path — no enrichment needed.
 */
export interface AppendMessagesEvent {
  messages: BaileysMessage[]
  sock: WASocket
}

/**
 * Fired when a message is revoked/deleted.
 */
export interface MessageDeletedEvent {
  messageId: string
  chatJid: string
  fromMe: boolean
}

/**
 * Fired when a message is edited.
 * Contains the full parsed edit content so subscribers don't need to re-query.
 */
export interface MessageEditedEvent {
  messageId: string
  chatJid: string
  editedTextContent: string | null
  editedContent: proto.IMessage | null  // null = already persisted by strategy, skip DB write
  sock: WASocket
}

/**
 * Fired for message status changes (server ack, delivery, read).
 * Maps to Baileys messages.update → update.update.status.
 */
export interface MessageStatusEvent {
  key: { id: string; remoteJid?: string | null; fromMe?: boolean | null }
  baileysStatus: number
}

// ─── Chat Events ──────────────────────────────────────────────────────────────

export interface ChatUpdatedEvent {
  jid: string
  update: ChatUpdatePayload
}

export interface ChatUpsertedEvent {
  jid: string
  raw: ChatUpdatePayload
}

// ─── Contact Events ───────────────────────────────────────────────────────────

export interface ContactUpsertedEvent {
  contacts: BaileysContact[]
}

export interface ContactUpdatedEvent {
  contacts: BaileysContact[]
}

export interface LidMappingEvent {
  mappings: Array<{ lid: string; pn: string }>
}

// ─── Group Events ─────────────────────────────────────────────────────────────

export interface GroupUpdatedEvent {
  updates: BaileysGroupUpdate[]
}

export interface GroupParticipantsEvent {
  id: string
  participants: string[]
  action: 'add' | 'remove' | 'promote' | 'demote' | string
}

// ─── Social Events ────────────────────────────────────────────────────────────

export interface ReactionEvent {
  reactions: BaileysReactionUpdate[]
  sock: WASocket | null
}

export interface PresenceEvent {
  id: string
  presences: Record<string, any>
  sock: WASocket
}

// ─── Receipt Events ───────────────────────────────────────────────────────────

export interface ReceiptEvent {
  updates: MessageReceiptUpdate[]
  sock: WASocket
}

// ─── Call Events ──────────────────────────────────────────────────────────────

export interface CallEvent {
  calls: BaileysCall[]
}

// ─── App State Sync Events ───────────────────────────────────────────────────

export interface AppStateSyncEvent {
  syncAction: any
  sock: WASocket
}

export interface FavoriteStickerSyncEvent {
  fileSha256: string
  isFavorite: boolean
  stickerAction?: any
  sock: WASocket
}

export interface MuteSyncEvent {
  chatJid: string
  muted: boolean
  muteEndTimestamp: bigint | null
}

export interface StarSyncEvent {
  chatJid: string
  messageId: string
  fromMe: boolean
  starred: boolean
}

export interface CallLogSyncEvent {
  chatJid: string
  callId: string
  isIncoming: boolean
  record: {
    callResult: string
    isDndMode: boolean
    silenceReason: string
    duration: number
    startTime: bigint
    isVideo: boolean
    isCallLink: boolean
    callCreatorJid: string
    participants: Array<{ userJid: string; callResult: string }>
    callType: string
  }
}

export interface LabelEditSyncEvent {
  labelId: string
  name: string
  color: number
  deleted: boolean
  isActive: boolean
  type: string
}

export interface SettingSyncEvent {
  settingType: string
  value: any
}

export interface LockSyncEvent {
  chatJid: string
  locked: boolean
}

export interface NotificationSettingSyncEvent {
  chatJid: string
  setting: string
}

export interface MessageStatusUpdatedEvent {
  id: string
  chatJid: string
  status: string
}

export interface ReactionProcessedEvent {
  id: string
  chatJid: string
  remoteJid: string
  fromMe: boolean
  senderId: number | null
  participant: string
  participantName: string
  timestamp: string
  messageType: 'reactionMessage'
  targetMessageType?: string
  targetTextContent?: string | null
  content: string
}

// ─── Bus Event Map ────────────────────────────────────────────────────────────

/**
 * Master map of event-name → payload type.
 * Used by WAEventBus for full type-safety.
 */
export interface WAEventMap {
  'message:incoming':    IncomingMessageEvent
  'messages:append':     AppendMessagesEvent
  'message:deleted':     MessageDeletedEvent
  'message:edited':      MessageEditedEvent
  'message:status':      MessageStatusEvent
  'message:status-updated': MessageStatusUpdatedEvent
  'chat:updated':        ChatUpdatedEvent
  'chat:upserted':       ChatUpsertedEvent
  'contact:upserted':    ContactUpsertedEvent
  'contact:updated':     ContactUpdatedEvent
  'lid:mapped':          LidMappingEvent
  'group:updated':       GroupUpdatedEvent
  'group:participants':  GroupParticipantsEvent
  'reaction:update':     ReactionEvent
  'reaction:processed':  ReactionProcessedEvent
  'presence:update':     PresenceEvent
  'receipt:update':      ReceiptEvent
  'call:event':          CallEvent
  'app-state:sync':      AppStateSyncEvent
  'app-state:favorite-sticker': FavoriteStickerSyncEvent
  'app-state:mute':             MuteSyncEvent
  'app-state:star':             StarSyncEvent
  'app-state:call-log':         CallLogSyncEvent
  'app-state:label-edit':       LabelEditSyncEvent
  'app-state:setting':          SettingSyncEvent
  'app-state:lock':             LockSyncEvent
  'app-state:notification-setting': NotificationSettingSyncEvent
}
