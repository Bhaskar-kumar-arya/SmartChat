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
  source?: 'whatsapp' | 'extension'
  extensionId?: string
  /**
   * True when this entry was pulled in only to complete a community grouping
   * (a root/sibling of a chat on the requested page) and does NOT belong to the
   * requested pagination window. Consumers must exclude these from end-of-list
   * ("did we get a full page?") accounting.
   */
  outOfWindow?: boolean
}
