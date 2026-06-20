import { Chat, Community, ChatMember, Identity, IdentityAlias, LidMap } from '@prisma/client'

export interface SyncChatCreateInput {
  jid: string
  type: string
  unreadCount: number
  timestamp: bigint
  pinned: number
  muteExpiration: bigint
  isArchived: boolean
  name: string | null
  communityId: number | null
  profilePictureUrl: string | null
}

export interface SyncChatUpdateInput {
  jid: string
  type: string
  isArchived: boolean
  communityId: number | null
  name?: string | null
  timestamp?: bigint
  unreadCount?: number
  pinned?: number
  muteExpiration?: bigint
  profilePictureUrl?: string | null
}

export interface SyncLidMapEntry {
  lid: string
  pn: string
  source: string
}

export interface SyncChatMemberUpsert {
  chatJid: string
  identityId: number
  role: string
}

export interface ISyncRepository {
  bulkUpsertCommunities(
    communities: Array<{ jid: string; name: string | null }>
  ): Promise<Community[]>

  bulkUpdateCommunityAnnounces(
    updates: Array<{ id: number; announceJid: string }>
  ): Promise<void>

  findExistingChats(jids: string[]): Promise<Chat[]>

  bulkCreateChats(chats: SyncChatCreateInput[]): Promise<void>

  bulkUpdateChats(chats: SyncChatUpdateInput[]): Promise<void>

  findIdentityAliases(jids: string[]): Promise<IdentityAlias[]>

  findIdentities(ids: number[], phoneNumbers: string[]): Promise<Identity[]>

  findLidMaps(lids: string[]): Promise<LidMap[]>

  bulkCreateIdentities(phoneNumbers: string[]): Promise<void>

  findIdentitiesByPhoneNumbers(phoneNumbers: string[]): Promise<Identity[]>

  createIdentity(phoneNumber: string | null): Promise<Identity>

  bulkUpdateIdentities(updates: Array<{ id: number; phoneNumber: string }>): Promise<void>

  bulkCreateIdentityAliases(
    aliases: Array<{ jid: string; type: string; identityId: number }>
  ): Promise<void>

  bulkUpdateIdentityAliases(
    aliases: Array<{ jid: string; identityId: number }>
  ): Promise<void>

  bulkUpsertLidMaps(entries: SyncLidMapEntry[], existingLids: Set<string>): Promise<void>

  findExistingMemberRoles(chatJids: string[]): Promise<ChatMember[]>

  bulkUpsertChatMembers(
    members: SyncChatMemberUpsert[],
    existingMemberKeys: Map<string, string>
  ): Promise<void>
}
