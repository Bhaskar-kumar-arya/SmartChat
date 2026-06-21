export interface ChatListEntry {
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
  lastMessageSender?: string | null
  lastMessageStatus?: string | null
  lastMessageFromMe?: boolean
  lastMessageId?: string | null
  lastMessageTargetType?: string | null
  lastMessageTargetText?: string | null
  lastMessageReactionText?: string | null
}
