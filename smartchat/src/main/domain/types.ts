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

export interface MessageUpsertData {
  id: string
  chatJid: string
  fromMe: boolean
  senderId?: number | null
  participant?: string | null
  timestamp: bigint
  messageType: string
  content: string
  textContent?: string | null
  status?: string | null
  isDeleted?: boolean
  isEdited?: boolean
}

export interface Chat {
  jid: string
  type: string
  unreadCount: number
  timestamp: bigint
  pinned: number
  muteExpiration: bigint
  isArchived: boolean
  profilePictureUrl: string | null
  name: string | null
  communityId: number | null
}

export interface Community {
  id: number
  jid: string
  name: string | null
  announceJid: string | null
}

export interface Identity {
  id: number
  phoneNumber: string | null
  displayName: string | null
  pushName: string | null
  verifiedName: string | null
  profilePictureUrl: string | null
  isMe: boolean
}

export interface IdentityAlias {
  jid: string
  type: string
  identityId: number
}

export interface Message {
  id: string
  chatJid: string
  senderId: number | null
  participant: string | null
  fromMe: boolean
  timestamp: bigint
  messageType: string
  content: string
  textContent: string | null
  isDeleted: boolean
  isEdited: boolean
  status: string | null
}

export interface Reaction {
  messageId: string
  senderId: number
  text: string
  timestamp: bigint
}

