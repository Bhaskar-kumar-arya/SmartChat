import { WASocket, BaileysReactionUpdate, MessageReceiptUpdate, BaileysCall } from '../types'

export interface ReactionEvent {
  reactions: BaileysReactionUpdate[]
  sock: WASocket | null
}

export interface PresenceEvent {
  id: string
  presences: Record<string, unknown>
  sock: WASocket
}

export interface ReceiptEvent {
  updates: MessageReceiptUpdate[]
  sock: WASocket
}

export interface CallEvent {
  calls: BaileysCall[]
}
