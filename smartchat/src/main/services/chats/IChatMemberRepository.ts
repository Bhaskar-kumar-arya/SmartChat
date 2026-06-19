import { ChatMember, Identity } from '@prisma/client'

export interface ChatMemberWithIdentity extends ChatMember {
  identity: Identity
}

export interface IChatMemberRepository {
  upsertChatMember(chatJid: string, identityId: number, role: string): Promise<ChatMember | null>
  deleteChatMember(chatJid: string, identityId: number): Promise<ChatMember | null>
  findChatMembers(chatJid: string): Promise<ChatMemberWithIdentity[]>
}
