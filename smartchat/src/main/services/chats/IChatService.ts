import { ChatUpdatePayload, WASocket } from '../whatsapp/types'
import { ChatListItem } from '../../ipc/types'

export interface IChatQueryService {
  getChatList(page?: number, pageSize?: number): Promise<ChatListItem[]>
  isChatMuted(jid: string): Promise<boolean>
}

export interface IChatMutationService {
  upsertChat(jid: string, update: ChatUpdatePayload): Promise<void>
  markRead(jid: string): Promise<boolean>
  incrementUnread(jid: string, timestamp: bigint): Promise<void>
  updateTimestamp(jid: string, timestamp: bigint): Promise<void>
}

export interface IGroupParticipantResolver {
  getGroupParticipants(
    jid: string,
    sock: WASocket | null
  ): Promise<Array<{ jid: string; name: string; isAdmin: boolean; isMe: boolean }>>
}

export interface IChatService extends IChatQueryService, IChatMutationService, IGroupParticipantResolver {}
