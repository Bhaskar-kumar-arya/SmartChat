import { proto } from '@whiskeysockets/baileys'
import { ProcessedMessage } from '../../../domain/types'
import { WASocket, BaileysMessage } from '../types'

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
