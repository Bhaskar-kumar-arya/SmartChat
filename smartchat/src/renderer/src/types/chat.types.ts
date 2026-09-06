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
  /**
   * Set when the backend pulled this chat in only to complete a community
   * grouping — it is outside the requested pagination window and must not count
   * toward "did we receive a full page?".
   */
  outOfWindow?: boolean
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
  // Extension-sourced synthetic chats
  source?: 'whatsapp' | 'extension'
  extensionId?: string
  extensionEmoji?: string
}
