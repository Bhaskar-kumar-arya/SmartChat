export interface BaileysGroupMetadata {
  id?: string
  name?: string
  subject?: string
  conversationTimestamp?: number | bigint
  timestamp?: number | bigint
  archived?: boolean
  isArchived?: boolean
  unreadCount?: number
  pinned?: number
  muteExpiration?: number | bigint
  profilePictureUrl?: string | null
  owner?: string
  ownerPn?: string
  descOwner?: string
  descOwnerPn?: string
  participants?: Array<{
    id: string
    lid?: string | null
    phoneNumber?: string | null
    admin?: 'admin' | 'superadmin' | null
  }>
}
