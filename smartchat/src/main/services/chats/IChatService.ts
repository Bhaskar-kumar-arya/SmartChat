import { ChatUpdatePayload, WASocket } from '../whatsapp/types'
import { ChatListItem } from '../../ipc/types'

export interface IChatService {
  upsertChat(jid: string, update: ChatUpdatePayload): Promise<void>
  markRead(jid: string): Promise<boolean>
  isChatMuted(jid: string): Promise<boolean>
  incrementUnread(jid: string, timestamp: bigint): Promise<void>
  updateTimestamp(jid: string, timestamp: bigint): Promise<void>
  getChatList(page?: number, pageSize?: number): Promise<ChatListItem[]>
  getGroupParticipants(
    jid: string,
    sock: WASocket | null
  ): Promise<Array<{ jid: string; name: string; isAdmin: boolean; isMe: boolean }>>
}
