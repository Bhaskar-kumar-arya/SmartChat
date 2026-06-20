import makeWASocket, { proto } from '@whiskeysockets/baileys'

export * from '../../domain/whatsapp.types'

/** Type alias for the Baileys WhatsApp socket instance. */
export type WASocket = ReturnType<typeof makeWASocket>

/** Nullable socket accessor — used for lazy socket access. */
export type SocketAccessor = () => WASocket | null

/** Protocol message result (revoke/edit). */
export interface ProtocolResult {
  type: 'protocol'
  subType: 'revoke' | 'edit'
  targetId: string
  chatJid?: string
  key: proto.IMessageKey
  editedTextContent?: string | null
  editedContent?: proto.IMessage | null
}

/** Raw Baileys message as received from events. */
export interface BaileysMessage {
  key: proto.IMessageKey
  message?: proto.IMessage | null
  messageTimestamp?: number | { low: number; high: number } | null
  pushName?: string | null
  status?: number | null
  messageStubType?: number | string | null
  messageStubParameters?: string[] | null
}

/** Options for sending media via WhatsApp. */
export interface MediaSendOptions {
  image?: Buffer; video?: Buffer; audio?: Buffer; document?: Buffer; sticker?: Buffer
  caption?: string; fileName?: string; mimetype?: string; ptt?: boolean
  mentions?: string[]
  gifPlayback?: boolean
  contextInfo?: proto.IContextInfo
}

/** Payload shape for message status receipt updates. */
export interface MessageReceiptUpdate {
  key: proto.IMessageKey
  receipt: {
    userJid?: string | null
    readTimestamp?: unknown
    receiptTimestamp?: unknown
    deliveredTimestamp?: unknown
  }
}

/** Raw Baileys reaction update event structure. */
export interface BaileysReactionUpdate {
  key: proto.IMessageKey
  reaction?: {
    key?: proto.IMessageKey | null
    text?: string | null
    senderTimestampMs?: number | { low: number; high: number } | null
  }
}

/** Type-safe extension of WASocket for accessing private signalRepository */
export interface BaileysSignalRepository {
  lidMapping?: {
    getPNForLID?: (lid: string) => Promise<string | undefined>
  }
}

export interface WASocketWithSignalRepository {
  signalRepository?: BaileysSignalRepository
}

