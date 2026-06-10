/**
 * WAEventTypes
 * ============
 * Typed domain event interfaces for the WAEventBus pub/sub system.
 *
 * These are clean, parsed representations of raw Baileys events.
 * Subscribers receive these types — no raw Baileys payloads leak through.
 */

import { WASocket, ProcessedMessage, MessageReceiptUpdate } from '../../types'

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
  messages: any[]
  sock: any
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
  editedContent: any | null  // null = already persisted by strategy, skip DB write
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
  update: Record<string, any>
}

export interface ChatUpsertedEvent {
  jid: string
  raw: Record<string, any>
}

// ─── Contact Events ───────────────────────────────────────────────────────────

export interface ContactUpsertedEvent {
  contacts: any[]
}

export interface ContactUpdatedEvent {
  contacts: any[]
}

export interface LidMappingEvent {
  mappings: Array<{ lid: string; pn: string }>
}

// ─── Group Events ─────────────────────────────────────────────────────────────

export interface GroupUpdatedEvent {
  updates: any[]
}

export interface GroupParticipantsEvent {
  id: string
  participants: string[]
  action: 'add' | 'remove' | 'promote' | 'demote' | string
}

// ─── Social Events ────────────────────────────────────────────────────────────

export interface ReactionEvent {
  reactions: any[]
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
  calls: any[]
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
  'chat:updated':        ChatUpdatedEvent
  'chat:upserted':       ChatUpsertedEvent
  'contact:upserted':    ContactUpsertedEvent
  'contact:updated':     ContactUpdatedEvent
  'lid:mapped':          LidMappingEvent
  'group:updated':       GroupUpdatedEvent
  'group:participants':  GroupParticipantsEvent
  'reaction:update':     ReactionEvent
  'presence:update':     PresenceEvent
  'receipt:update':      ReceiptEvent
  'call:event':          CallEvent
}
