import { IChatListEnricher } from '../../../services/chats/IChatListEnricher'
import { ChatListEntry } from '../../../domain/chatList.types'

export class WorkerNullChatListEnricher implements IChatListEnricher {
  async getChatList(_page?: number, _pageSize?: number): Promise<ChatListEntry[]> {
    return []
  }

  async getChatByJid(_jid: string): Promise<ChatListEntry | null> {
    return null
  }
}
