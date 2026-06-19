import makeWASocket, { proto } from '@whiskeysockets/baileys'

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

/** Payload shape for chat update events. */
export interface ChatUpdatePayload {
  id?: string | null; name?: string | null; subject?: string | null
  unreadCount?: number | null; pinned?: number | null; muteExpiration?: unknown; muteEndTime?: unknown
  archived?: boolean | null; conversationTimestamp?: unknown; timestamp?: unknown
  profilePictureUrl?: string | null
  isCommunity?: boolean | null; isParentGroup?: boolean | null; isAnnounce?: boolean | null
  isCommunityAnnounce?: boolean | null; isDefaultSubgroup?: boolean | null
  linkedParentJid?: string | null; linkedParent?: string | null; parentGroupId?: string | null
  owner?: string | null; ownerPn?: string | null; descOwner?: string | null; descOwnerPn?: string | null
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

/** Baileys Call structure representing call events */
export interface BaileysCall {
  id: string
  from: string
  status: string
  timestamp?: number | bigint | null
  callerPn?: string
  callerLid?: string
  content?: {
    attrs?: Record<string, string>
  }
  attrs?: Record<string, string>
}

/** Baileys Contact structure from Baileys events */
export interface BaileysContact {
  id?: string | null
  name?: string | null
  notify?: string | null
  verifiedName?: string | null
  imgUrl?: string | null
  status?: string | null
  lid?: string | null
  phoneNumber?: string | null
}

/** Baileys Group Update structure representing group metadata updates */
export interface BaileysGroupUpdate {
  id?: string
  subject?: string
  participants?: Array<{ id?: string; userJid?: string; [key: string]: any }>
  [key: string]: any
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

export interface MediaMessageWithLocalUri {
  localURI?: string | null
}
