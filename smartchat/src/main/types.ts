import makeWASocket from '@whiskeysockets/baileys'

/** Type alias for the Baileys WhatsApp socket instance. */
export type WASocket = ReturnType<typeof makeWASocket>

/** Nullable socket accessor — used for lazy socket access. */
export type SocketAccessor = () => WASocket | null

/** Enriched message returned to the frontend via IPC. */
export interface EnrichedMessage {
  id: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  participantName: string
  timestamp: string
  messageType: string
  content: string
  reactions?: EnrichedReaction[]
  isDeleted?: boolean
  isEdited?: boolean
  status?: string | null
}

/** Chat list item as returned to the frontend. */
export interface ChatListItem {
  jid: string
  name: string
  unreadCount: number
  timestamp: string
  lastMessage: string
  lastMessageType?: string | null
  lastMessageTimestamp: string
  pinned: number
  muteExpiration: string
  profilePictureUrl: string | null
  isCommunity: boolean
  isAnnounce: boolean
  linkedParentJid: string | null
}

/** Enriched reaction for UI display. */
export interface EnrichedReaction {
  text: string
  senderId: string
  senderName: string
  timestamp: string
}

/** Protocol message result (revoke/edit). */
export interface ProtocolResult {
  type: 'protocol'
  subType: 'revoke' | 'edit'
  targetId: string
  key: any
}

/** Raw Baileys message as received from events. */
export interface BaileysMessage {
  key: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null; participant?: string | null }
  message?: any
  messageTimestamp?: number | { low: number; high: number } | null
  pushName?: string | null
  status?: number | null
}

/** Database message row with sender relation included. */
export interface DBMessageWithSender {
  id: string
  chatJid: string
  fromMe: boolean
  senderId: number | null
  participant: string | null
  timestamp: bigint
  messageType: string
  content: string
  textContent: string | null
  isDeleted: boolean
  isEdited: boolean
  status: string | null
  sender?: { displayName?: string | null; pushName?: string | null; verifiedName?: string | null; phoneNumber?: string | null } | null
}

/** Options for sending media via WhatsApp. */
export interface MediaSendOptions {
  image?: Buffer; video?: Buffer; audio?: Buffer; document?: Buffer; sticker?: Buffer
  caption?: string; fileName?: string; mimetype?: string; ptt?: boolean
  mentions?: string[]
  gifPlayback?: boolean
}

/** Payload shape for chat update events. */
export interface ChatUpdatePayload {
  id?: string; name?: string; subject?: string
  unreadCount?: number; pinned?: number; muteExpiration?: number | bigint
  archived?: boolean; conversationTimestamp?: unknown; timestamp?: unknown
  profilePictureUrl?: string
  isCommunity?: boolean; isParentGroup?: boolean; isAnnounce?: boolean
  isCommunityAnnounce?: boolean; isDefaultSubgroup?: boolean
  linkedParentJid?: string; linkedParent?: string; parentGroupId?: string
  owner?: string; ownerPn?: string; descOwner?: string; descOwnerPn?: string
}

/** Processed message returned by processMessage. */
export interface ProcessedMessage {
  id: string
  chatJid: string
  fromMe: boolean
  senderId: number | null
  participant: string | null
  timestamp: bigint
  messageType: string
  textContent: string | null
  content: string
  isDeleted: boolean
  isEdited: boolean
  status: string | null
}

/** Payload shape for message status receipt updates. */
export interface MessageReceiptUpdate {
  key: { id: string; remoteJid?: string; fromMe?: boolean; participant?: string }
  receipt: {
    userJid?: string
    readTimestamp?: number | bigint | null
    receiptTimestamp?: number | bigint | null
  }
}

/** Raw Baileys reaction update event structure. */
export interface BaileysReactionUpdate {
  key: { id: string }
  reaction?: {
    key: {
      id?: string
      remoteJid?: string
      fromMe?: boolean
      participant?: string
      participantAlt?: string
    }
    text?: string | null
    senderTimestampMs?: number | { low: number; high: number } | null
  }
}
