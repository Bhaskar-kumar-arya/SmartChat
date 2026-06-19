import { ChatUpdatePayload } from '../types'

export interface ChatUpdatedEvent {
  jid: string
  update: ChatUpdatePayload
}

export interface ChatUpsertedEvent {
  jid: string
  raw: ChatUpdatePayload
}
