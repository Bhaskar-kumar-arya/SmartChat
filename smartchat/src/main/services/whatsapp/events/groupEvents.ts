import { BaileysGroupUpdate } from '../types'

export interface GroupUpdatedEvent {
  updates: BaileysGroupUpdate[]
}

export interface GroupParticipantsEvent {
  id: string
  participants: string[]
  action: 'add' | 'remove' | 'promote' | 'demote' | string
}

export interface GroupEventMap {
  'group:updated': GroupUpdatedEvent
  'group:participants': GroupParticipantsEvent
}

