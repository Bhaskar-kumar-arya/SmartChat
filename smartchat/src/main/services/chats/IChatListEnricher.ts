import { ChatListEntry } from '../../domain/chatList.types'

export interface IChatListEnricher {
  getChatList(page?: number, pageSize?: number): Promise<ChatListEntry[]>
  getChatByJid(jid: string): Promise<ChatListEntry | null>
}
