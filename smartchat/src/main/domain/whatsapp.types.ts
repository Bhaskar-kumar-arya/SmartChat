/** Payload shape for chat update events. */
export interface ChatUpdatePayload {
  id?: string | null; name?: string | null; subject?: string | null
  unreadCount?: number | null; pinned?: number | null; muteExpiration?: unknown; muteEndTime?: unknown
  archived?: boolean | null; conversationTimestamp?: unknown; timestamp?: unknown
  profilePictureUrl?: string | null
  isCommunity?: boolean | null; isParentGroup?: boolean | null; isAnnounce?: boolean | null
  isCommunityAnnounce?: boolean | null; isDefaultSubgroup?: boolean | null
  linkedParentJid?: string | null; linkedParent?: string | null; parentGroupId?: string | null
  owner?: string | null; ownerPn?: string | null; descOwner?: string | null; descOwnerPn?: string | null
}

/** Baileys Call structure representing call events */
export interface BaileysCall {
  id: string
  from: string
  status: string
  timestamp?: number | bigint | null
  callerPn?: string
  callerLid?: string
  content?: {
    attrs?: Record<string, string>
  }
  attrs?: Record<string, string>
}

/** Baileys Contact structure from Baileys events */
export interface BaileysContact {
  id?: string | null
  name?: string | null
  notify?: string | null
  verifiedName?: string | null
  imgUrl?: string | null
  status?: string | null
  lid?: string | null
  phoneNumber?: string | null
}

/** Baileys Group Update structure representing group metadata updates */
export interface BaileysGroupUpdate {
  id?: string
  subject?: string
  participants?: Array<{ id?: string; userJid?: string; admin?: 'admin' | 'superadmin' | null }>
  [key: string]: unknown
}

export interface MediaMessageWithLocalUri {
  localURI?: string | null
}
