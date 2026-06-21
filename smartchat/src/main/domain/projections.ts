import { Message, Chat, Community, Identity } from './entities'

export interface LastMessageWithSender {
  id: string
  textContent: string | null
  messageType: string
  timestamp: bigint
  fromMe: boolean
  participant: string | null
  status: string | null
  sender: {
    displayName: string | null
    pushName: string | null
    verifiedName: string | null
    phoneNumber: string | null
  } | null
}

export interface MessageWithChatAndSender extends Message {
  chat: Chat & { community: Community | null } | null
  sender: Identity | null
}
