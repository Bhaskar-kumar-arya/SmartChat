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
  status?: string
}

/** Chat list item as returned to the frontend. */
export interface ChatListItem {
  jid: string
  name: string
  unreadCount: number
  timestamp: string
  lastMessage: string
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
  key: { id: string; remoteJid?: string; fromMe?: boolean; participant?: string }
  message?: Record<string, unknown>
  messageTimestamp?: number | { low: number; high: number }
  pushName?: string
  status?: number
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
  participants?: any[]
}
