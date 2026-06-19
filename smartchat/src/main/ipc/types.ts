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
  lastMessageSender?: string | null
  lastMessageStatus?: string | null
  lastMessageFromMe?: boolean
  lastMessageId?: string | null
  lastMessageTargetType?: string | null
  lastMessageTargetText?: string | null
  lastMessageReactionText?: string | null
}

/** Enriched reaction for UI display. */
export interface EnrichedReaction {
  text: string
  senderId: string
  senderName: string
  timestamp: string
}
