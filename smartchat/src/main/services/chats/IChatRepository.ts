import { Chat } from '@prisma/client'

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

export interface IChatRepository {
  findChatByJid(jid: string): Promise<Chat | null>
  findChatsByJids(jids: string[]): Promise<Chat[]>
  findChatsPaginated(skip: number, take: number): Promise<ChatWithCommunity[]>
  findChatsByJidsWithCommunity(jids: string[]): Promise<ChatWithCommunity[]>
  upsertChat(jid: string, data: ChatUpsertData): Promise<Chat>
  updateChatUnreadCount(jid: string, count: number): Promise<Chat>
  findChatMuteExpiration(jid: string): Promise<{ muteExpiration: bigint } | null>
  incrementUnread(jid: string, timestamp: bigint): Promise<Chat>
  updateTimestamp(jid: string, timestamp: bigint): Promise<Chat>
  findChats(jids?: string[]): Promise<Chat[]>
  searchChats(query: string, take?: number): Promise<Array<{ jid: string; name: string | null; type: string; profilePictureUrl: string | null }>>
  findAllChatJids(): Promise<string[]>
  countChats(): Promise<number>
  bulkCreateChats(chats: Array<{ jid: string; type: string }>): Promise<void>
}
