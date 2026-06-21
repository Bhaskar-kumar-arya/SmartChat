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
