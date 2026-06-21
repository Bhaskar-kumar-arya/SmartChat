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

import { MessageEventMap } from './events/messageEvents'
import { ChatEventMap } from './events/chatEvents'
import { ContactEventMap } from './events/contactEvents'
import { GroupEventMap } from './events/groupEvents'
import { SyncEventMap } from './events/syncEvents'
import { MiscEventMap } from './events/miscEvents'

// ─── Bus Event Map ────────────────────────────────────────────────────────────

/**
 * Master map of event-name → payload type.
 * Used by WAEventBus for full type-safety.
 */
export type WAEventMap = MessageEventMap &
  ChatEventMap &
  ContactEventMap &
  GroupEventMap &
  SyncEventMap &
  MiscEventMap

