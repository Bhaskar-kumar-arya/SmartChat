import { ISocketUserContext } from '../../contacts/IContactService'
import { BaileysReactionUpdate, MessageReceiptUpdate, BaileysCall } from '../types'

export interface ReactionEvent {
  reactions: BaileysReactionUpdate[]
  sock: ISocketUserContext | null
}

export interface PresenceEvent {
  id: string
  presences: Record<string, unknown>
  sock: ISocketUserContext
}

export interface ReceiptEvent {
  updates: MessageReceiptUpdate[]
  sock: ISocketUserContext
}

export interface CallEvent {
  calls: BaileysCall[]
}

