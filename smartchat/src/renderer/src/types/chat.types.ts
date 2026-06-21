export interface ChatItem {
  jid: string
  name: string
  unreadCount: number
  timestamp: string
  lastMessage: string
  lastMessageType?: string | null
  lastMessageTimestamp: string
  pinned?: number
  muteExpiration?: string
  profilePictureUrl?: string | null
  isCommunity?: boolean
  isAnnounce?: boolean
  linkedParentJid?: string | null
  pushName?: string | null
  verifiedName?: string | null
  phoneNumber?: string | null
  lastMessageSender?: string | null
  lastMessageStatus?: string | null
  lastMessageFromMe?: boolean
  lastMessageId?: string | null
  lastMessageTargetType?: string | null
  lastMessageTargetText?: string | null
  lastMessageReactionText?: string | null
}

export interface SelectedContext {
  jid: string
  name: string
}

export interface ExtendedChatItem extends ChatItem {
  isChild?: boolean
  parentName?: string
  totalUnreadCount?: number
  children?: ChatItem[]
}
