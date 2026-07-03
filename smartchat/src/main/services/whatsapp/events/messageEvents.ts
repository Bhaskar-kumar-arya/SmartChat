import { proto } from '@whiskeysockets/baileys'
import { ProcessedMessage } from '../../../domain/db.types'
import { ISocketUserContext } from '../../contacts/IContactService'
import { BaileysMessage } from '../types'
import { EnrichedMessage } from '../../../ipc/message.types'

/**
 * Fired for each real-time incoming message (Baileys type='notify').
 * Enrichment (name resolution, profile pic) happens inside the handler
 * before the event is emitted to guarantee IPC ordering.
 */
export interface IncomingMessageEvent {
  chatJid: string
  senderJid: string
  messageType: string
  textContent: string | null
  fromMe: boolean
  timestamp: bigint
  processed: ProcessedMessage  // full processed row for subscribers that need detail
  sock: ISocketUserContext
  enriched: EnrichedMessage
}

/**
 * Fired for bulk backlog messages (Baileys type='append').
 * Fast path — no enrichment needed.
 */
export interface AppendMessagesEvent {
  messages: BaileysMessage[]
  sock: ISocketUserContext
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
 * Carries fromMe and participant so subscribers don't need an extra DB read for identity context.
 */
export interface MessageEditedEvent {
  messageId: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  editedTextContent: string | null
  editedContent: proto.IMessage | null  // null = already persisted by strategy, skip DB write
  sock: ISocketUserContext
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

/**
 * Fired when a message is successfully decrypted.
 * Carries fromMe and participant so subscribers don't need an extra DB read for identity context.
 */
export interface MessageDecryptedEvent {
  messageId: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  messageType: string
  textContent: string | null
  content: Record<string, unknown>
  sock: ISocketUserContext
}

export interface MessageEventMap {
  'message:incoming': IncomingMessageEvent
  'messages:append': AppendMessagesEvent
  'message:deleted': MessageDeletedEvent
  'message:edited': MessageEditedEvent
  'message:decrypted': MessageDecryptedEvent
  'message:status': MessageStatusEvent
  'message:status-updated': MessageStatusUpdatedEvent
  'reaction:processed': ReactionProcessedEvent
}

