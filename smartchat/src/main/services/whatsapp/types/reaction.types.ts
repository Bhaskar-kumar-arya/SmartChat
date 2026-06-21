import { proto } from '@whiskeysockets/baileys'
import { WAMessageKey } from '../../../domain/whatsapp.types'

export type BaileysReaction = proto.IReaction

/** Raw Baileys reaction update event structure. */
export interface BaileysReactionUpdate {
  key: WAMessageKey
  reaction?: {
    key?: WAMessageKey | null
    text?: string | null
    senderTimestampMs?: number | { low: number; high: number } | null
  }
}
