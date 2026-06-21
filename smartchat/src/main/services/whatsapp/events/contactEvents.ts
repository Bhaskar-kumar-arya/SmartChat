import { BaileysContact } from '../types'

export interface ContactUpsertedEvent {
  contacts: BaileysContact[]
}

export interface ContactUpdatedEvent {
  contacts: BaileysContact[]
}

export interface LidMappingEvent {
  mappings: Array<{ lid: string; pn: string }>
}

export interface ContactEventMap {
  'contact:upserted': ContactUpsertedEvent
  'contact:updated': ContactUpdatedEvent
  'lid:mapped': LidMappingEvent
}

