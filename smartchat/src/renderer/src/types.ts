export interface ChatItem {
  jid: string
  name: string
  unreadCount: number
  timestamp: string
  lastMessage: string
  lastMessageTimestamp: string
  pinned?: number
  muteExpiration?: string
}

export interface ReactionItem {
  senderId: string
  senderName?: string | null
  text: string
  timestamp: string
}

export interface MessageItem {
  id: string
  remoteJid: string
  fromMe: boolean
  participant: string | null
  participantName?: string | null
  timestamp: string
  messageType: string
  textContent: string | null
  content?: string
  localURI?: string
  reactions?: ReactionItem[]
}

export interface PresenceUpdate {
  remoteJid: string
  presences: Record<string, {
    lastKnownPresence: 'composing' | 'recording' | 'available' | 'unavailable' | string
    timestamp: number
    name?: string
  }>
}
