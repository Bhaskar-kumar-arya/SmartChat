import { WAMessageKey, WAMessageContent } from '../../../domain/whatsapp.types'
import { BaileysReaction } from './reaction.types'
import { proto } from '@whiskeysockets/baileys'

export type BaileysWebMessageInfo = proto.IWebMessageInfo
export type WAContextInfo = proto.IContextInfo

export const parseProtoMessage = (raw: unknown): WAMessageContent => {
  return proto.Message.fromObject(raw as Record<string, unknown>)
}

/** Protocol message result (revoke/edit). */
export interface ProtocolResult {
  type: 'protocol'
  subType: 'revoke' | 'edit'
  targetId: string
  chatJid?: string
  key: WAMessageKey
  editedTextContent?: string | null
  editedContent?: WAMessageContent | null
}

/** Raw Baileys message as received from events. */
export interface BaileysMessage {
  key: WAMessageKey
  message?: WAMessageContent | null
  messageTimestamp?: number | { low: number; high: number } | null
  pushName?: string | null
  status?: number | null
  messageStubType?: number | string | null
  messageStubParameters?: string[] | null
  reactions?: BaileysReaction[] | null
}
