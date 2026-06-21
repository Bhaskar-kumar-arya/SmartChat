export interface ReactionItem {
  senderId: string
  senderName?: string | null
  text: string
  timestamp: string
}

export interface MessageItem {
  id: string
  chatJid: string
  fromMe: boolean
  participant: string | null
  participantName?: string | null
  timestamp: string
  messageType: string
  textContent: string | null
  content?: string
  localURI?: string
  reactions?: ReactionItem[]
  isDeleted?: boolean
  isEdited?: boolean
  status?: string
  targetMessageType?: string
  targetTextContent?: string | null
}

export interface MessageReceiptInfo {
  userJid: string
  name: string
  status: string
  timestamp: string
}

export type MessageType =
  | 'stickerMessage'
  | 'lottieStickerMessage'
  | 'imageMessage'
  | 'videoMessage'
  | 'ptvMessage'
  | 'documentMessage'
  | 'audioMessage'
  | 'conversation'
  | 'extendedTextMessage'
  | 'templateMessage'
  | 'reactionMessage'
  | 'unknown'
