import { EnrichedMessage } from '../../ipc/message.types'

export interface ExtensionMessageIncomingEvent {
  chatJid: string
  senderJid: string
  textContent: string | null
  fromMe: boolean
  timestamp: bigint
  enriched: EnrichedMessage
}

export interface ExtensionMessageDeletedEvent {
  messageId: string
  chatJid: string
  fromMe: boolean
}

export interface ExtensionMessageEditedEvent {
  messageId: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  editedTextContent: string | null
}

export interface ExtensionMessageStatusUpdatedEvent {
  id: string
  chatJid: string
  status: string
}

export interface ExtensionReactionProcessedEvent {
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

export interface ExtensionChatCreatedEvent {
  jid: string
  name?: string
}

export interface ExtensionChatArchivedEvent {
  jid: string
  archived: boolean
}

export interface ExtensionChatPinnedEvent {
  jid: string
  pinned: boolean
}

export interface ExtensionContactUpdatedEvent {
  jid: string
  name?: string
  pushName?: string
}

export interface ExtensionGroupParticipantAddedEvent {
  id: string
  participants: string[]
}

export interface ExtensionGroupParticipantRemovedEvent {
  id: string
  participants: string[]
}

export interface ExtensionGroupSubjectChangedEvent {
  id: string
  subject: string
}

export interface ExtensionConnectionOpenEvent {}
export interface ExtensionConnectionCloseEvent {}

export interface ExtensionDedicatedChatMessageEvent {
  text: string
}

export interface ExtensionEventMap {
  'message:incoming': ExtensionMessageIncomingEvent
  'message:deleted': ExtensionMessageDeletedEvent
  'message:edited': ExtensionMessageEditedEvent
  'message:status-updated': ExtensionMessageStatusUpdatedEvent
  'reaction:processed': ExtensionReactionProcessedEvent
  'chat:created': ExtensionChatCreatedEvent
  'chat:archived': ExtensionChatArchivedEvent
  'chat:pinned': ExtensionChatPinnedEvent
  'contact:updated': ExtensionContactUpdatedEvent
  'group:participant-added': ExtensionGroupParticipantAddedEvent
  'group:participant-removed': ExtensionGroupParticipantRemovedEvent
  'group:subject-changed': ExtensionGroupSubjectChangedEvent
  'connection:open': ExtensionConnectionOpenEvent
  'connection:close': ExtensionConnectionCloseEvent
  'extension:chat-message': ExtensionDedicatedChatMessageEvent
}

export type ExtensionEventName = keyof ExtensionEventMap
