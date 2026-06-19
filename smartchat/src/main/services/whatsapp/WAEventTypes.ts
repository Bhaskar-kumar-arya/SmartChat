/**
 * WAEventTypes
 * ============
 * Typed domain event interfaces for the WAEventBus pub/sub system.
 *
 * These are clean, parsed representations of raw Baileys events.
 * Subscribers receive these types — no raw Baileys payloads leak through.
 */

export * from './events/messageEvents'
export * from './events/chatEvents'
export * from './events/contactEvents'
export * from './events/groupEvents'
export * from './events/syncEvents'
export * from './events/miscEvents'

import {
  IncomingMessageEvent,
  AppendMessagesEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  MessageStatusEvent,
  MessageStatusUpdatedEvent,
  ReactionProcessedEvent
} from './events/messageEvents'
import { ChatUpdatedEvent, ChatUpsertedEvent } from './events/chatEvents'
import { ContactUpsertedEvent, ContactUpdatedEvent, LidMappingEvent } from './events/contactEvents'
import { GroupUpdatedEvent, GroupParticipantsEvent } from './events/groupEvents'
import {
  AppStateSyncEvent,
  FavoriteStickerSyncEvent,
  MuteSyncEvent,
  StarSyncEvent,
  CallLogSyncEvent,
  LabelEditSyncEvent,
  SettingSyncEvent,
  LockSyncEvent,
  NotificationSettingSyncEvent
} from './events/syncEvents'
import { ReactionEvent, PresenceEvent, ReceiptEvent, CallEvent } from './events/miscEvents'

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
