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

export interface PluginChatCreatedEvent {
  jid: string
  name?: string
}

export interface PluginChatArchivedEvent {
  jid: string
  archived: boolean
}

export interface PluginChatPinnedEvent {
  jid: string
  pinned: boolean
}

export interface PluginContactUpdatedEvent {
  jid: string
  name?: string
  pushName?: string
}

export interface PluginGroupParticipantAddedEvent {
  id: string
  participants: string[]
}

export interface PluginGroupParticipantRemovedEvent {
  id: string
  participants: string[]
}

export interface PluginGroupSubjectChangedEvent {
  id: string
  subject: string
}

export interface PluginConnectionOpenEvent {}
export interface PluginConnectionCloseEvent {}

export interface PluginEventMap {
  'message:incoming': PluginMessageIncomingEvent
  'message:deleted': PluginMessageDeletedEvent
  'message:edited': PluginMessageEditedEvent
  'message:status-updated': PluginMessageStatusUpdatedEvent
  'reaction:processed': PluginReactionProcessedEvent
  'chat:created': PluginChatCreatedEvent
  'chat:archived': PluginChatArchivedEvent
  'chat:pinned': PluginChatPinnedEvent
  'contact:updated': PluginContactUpdatedEvent
  'group:participant-added': PluginGroupParticipantAddedEvent
  'group:participant-removed': PluginGroupParticipantRemovedEvent
  'group:subject-changed': PluginGroupSubjectChangedEvent
  'connection:open': PluginConnectionOpenEvent
  'connection:close': PluginConnectionCloseEvent
  [key: string]: unknown
}

export type PluginEventName = Extract<keyof PluginEventMap, string>
