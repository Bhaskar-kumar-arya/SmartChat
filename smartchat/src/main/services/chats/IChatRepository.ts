import { Chat } from '../../domain/entities'

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
    name: string | null
  } | null
}

export interface IChatReadRepository {
  findChatByJid(jid: string): Promise<Chat | null>
  findChatsByJids(jids: string[]): Promise<Chat[]>
  findChatsPaginated(skip: number, take: number): Promise<ChatWithCommunity[]>
  findChatsByJidsWithCommunity(jids: string[]): Promise<ChatWithCommunity[]>
  findChatsByCommunityJids(communityJids: string[]): Promise<ChatWithCommunity[]>
  findChatMuteExpiration(jid: string): Promise<{ muteExpiration: bigint } | null>
  findChats(jids?: string[]): Promise<Chat[]>
  searchChats(query: string, take?: number): Promise<Array<{ jid: string; name: string | null; type: string; profilePictureUrl: string | null }>>
  findAllChatJids(): Promise<string[]>
  countChats(): Promise<number>
}

export interface IChatWriteRepository {
  upsertChat(jid: string, data: ChatUpsertData): Promise<Chat>
  updateChatUnreadCount(jid: string, count: number): Promise<Chat>
  incrementUnread(jid: string, timestamp: bigint, amount?: number): Promise<Chat>
  updateTimestamp(jid: string, timestamp: bigint): Promise<Chat>
  bulkCreateChats(chats: Array<{ jid: string; type: string }>): Promise<void>
  deleteChat(jid: string): Promise<void>
}

export interface IChatRepository extends IChatReadRepository, IChatWriteRepository {}
