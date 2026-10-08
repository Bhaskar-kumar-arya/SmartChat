export interface PluginMessageIncomingEvent {
  chatJid: string
  senderJid: string
  textContent: string | null
  fromMe: boolean
  timestamp: bigint
  enriched?: unknown
}

export interface PluginMessageDeletedEvent {
  messageId: string
  chatJid: string
  fromMe: boolean
}

export interface PluginMessageEditedEvent {
  messageId: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  editedTextContent: string | null
}

export interface PluginMessageStatusUpdatedEvent {
  id: string
  chatJid: string
  status: string
}

export interface PluginReactionProcessedEvent {
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

/** Mirrors `ChatUpdatedEvent` (WAEventMap `chat:updated`); `update` is the partial chat patch. */
export interface PluginChatUpdatedEvent {
  jid: string
  update: Record<string, unknown>
}

/** Mirrors `ContactUpdatedEvent` (WAEventMap `contact:updated`); entries are raw contact records. */
export interface PluginContactUpdatedEvent {
  contacts: Array<Record<string, unknown>>
}

/** Mirrors `GroupParticipantsEvent` (WAEventMap `group:participants`). */
export interface PluginGroupParticipantsEvent {
  id: string
  participants: string[]
  action: 'add' | 'remove' | 'promote' | 'demote' | string
}

/** Mirrors `GroupUpdatedEvent` (WAEventMap `group:updated`); entries are raw group updates. */
export interface PluginGroupUpdatedEvent {
  updates: Array<Record<string, unknown>>
}

/**
 * Events a plugin can subscribe to (requires `events:<name>` or `events:*`). Every named key
 * is a WAEventMap bus event; the index signature admits other bus events as `unknown`.
 */
export interface PluginEventMap {
  'message:incoming': PluginMessageIncomingEvent
  'message:deleted': PluginMessageDeletedEvent
  'message:edited': PluginMessageEditedEvent
  'message:status-updated': PluginMessageStatusUpdatedEvent
  'reaction:processed': PluginReactionProcessedEvent
  'chat:updated': PluginChatUpdatedEvent
  'contact:updated': PluginContactUpdatedEvent
  'group:participants': PluginGroupParticipantsEvent
  'group:updated': PluginGroupUpdatedEvent
  [key: string]: unknown
}

export type PluginEventName = Extract<keyof PluginEventMap, string>
