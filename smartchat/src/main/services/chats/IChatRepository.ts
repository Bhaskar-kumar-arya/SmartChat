import { Chat, Community, ChatMember, Identity } from '@prisma/client'

export interface ChatUpsertData {
  unreadCount?: number
  pinned?: number
  muteExpiration?: bigint
  isArchived?: boolean
  name?: string | null
  profilePictureUrl?: string | null
  timestamp?: bigint
  type?: string
  communityId?: number | null
}

export interface ChatWithCommunity extends Chat {
  community: {
    jid: string
  } | null
}

export interface ChatMemberWithIdentity extends ChatMember {
  identity: Identity
}

export interface IChatRepository {
  findChatByJid(jid: string): Promise<Chat | null>
  findChatsByJids(jids: string[]): Promise<Chat[]>
  findChatsPaginated(skip: number, take: number): Promise<ChatWithCommunity[]>
  findChatsByJidsWithCommunity(jids: string[]): Promise<ChatWithCommunity[]>
  upsertChat(jid: string, data: ChatUpsertData): Promise<Chat>
  upsertCommunity(jid: string, name: string | null): Promise<Community>
  updateCommunityAnnounceJid(id: number, announceJid: string): Promise<Community>
  updateChatUnreadCount(jid: string, count: number): Promise<Chat>
  findChatMuteExpiration(jid: string): Promise<{ muteExpiration: bigint } | null>
  upsertChatMember(chatJid: string, identityId: number, role: string): Promise<ChatMember | null>
  deleteChatMember(chatJid: string, identityId: number): Promise<ChatMember | null>
  findChatMembers(chatJid: string): Promise<ChatMemberWithIdentity[]>
  incrementUnread(jid: string, timestamp: bigint): Promise<Chat>
  updateTimestamp(jid: string, timestamp: bigint): Promise<Chat>
  findChats(jids?: string[]): Promise<Chat[]>
  searchChats(query: string, take?: number): Promise<Array<{ jid: string; name: string | null; type: string; profilePictureUrl: string | null }>>
  findAllChatJids(): Promise<string[]>
  countChats(): Promise<number>
  bulkCreateChats(chats: Array<{ jid: string; type: string }>): Promise<void>
}
