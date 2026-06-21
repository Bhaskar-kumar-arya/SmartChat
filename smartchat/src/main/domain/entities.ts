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
