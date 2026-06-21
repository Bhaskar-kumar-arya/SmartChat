import { ChatUpdatePayload } from '../../domain/whatsapp.types'
import { ChatListEntry } from '../../domain/chatList.types'

export interface IChatQueryService {
  getChatList(page?: number, pageSize?: number): Promise<ChatListEntry[]>
  isChatMuted(jid: string): Promise<boolean>
}

export interface IChatMutationService {
  upsertChat(jid: string, update: ChatUpdatePayload): Promise<void>
  markRead(jid: string): Promise<boolean>
  incrementUnread(jid: string, timestamp: bigint): Promise<void>
  updateTimestamp(jid: string, timestamp: bigint): Promise<void>
}

export interface GroupParticipant {
  jid: string
  name: string
  isAdmin: boolean
  isMe: boolean
}

export interface IGroupParticipantResolver {
  getGroupParticipants(
    jid: string
  ): Promise<GroupParticipant[]>
}

export interface IChatService extends IChatQueryService, IChatMutationService, IGroupParticipantResolver {}


