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
