import { ChatUpdatePayload } from '../types'

export interface ChatUpdatedEvent {
  jid: string
  update: ChatUpdatePayload
}

export interface ChatUpsertedEvent {
  jid: string
  raw: ChatUpdatePayload
}

export interface ChatEventMap {
  'chat:updated': ChatUpdatedEvent
  'chat:upserted': ChatUpsertedEvent
}

