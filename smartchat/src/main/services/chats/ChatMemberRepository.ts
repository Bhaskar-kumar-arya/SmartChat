import { PrismaClient, ChatMember } from '@prisma/client'
import { IChatMemberRepository, ChatMemberWithIdentity } from './IChatMemberRepository'

/**
 * ChatMemberRepository — Encapsulates database operations for the ChatMember table.
 */
export class ChatMemberRepository implements IChatMemberRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert a group member row.
   */
  async upsertChatMember(chatJid: string, identityId: number, role: string): Promise<ChatMember | null> {
    // Guard 1: Ensure the parent Chat row exists (FK → Chat.jid)
    const existingChat = await this.prisma.chat.findUnique({ where: { jid: chatJid } })
    if (!existingChat) {
      const type = chatJid.endsWith('@g.us') ? 'GROUP' : 'DM'
      try {
        await this.prisma.chat.create({
          data: {
            jid: chatJid,
            type,
            unreadCount: 0,
            timestamp: 0n,
            pinned: 0,
            muteExpiration: 0n,
            isArchived: false
          }
        })
      } catch (err) {
        // Race condition: another process created the row — check again
        const recheckChat = await this.prisma.chat.findUnique({ where: { jid: chatJid } })
        if (!recheckChat) {
          console.error(`[ChatMemberRepository] upsertChatMember: cannot create/find chat ${chatJid}; skipping member insert`)
          return null
        }
      }
    }

    // Guard 2: Ensure the Identity row exists (FK → Identity.id).
    const existingIdentity = await this.prisma.identity.findUnique({ where: { id: identityId } })
    if (!existingIdentity) {
      console.warn(`[ChatMemberRepository] upsertChatMember: identity ${identityId} no longer exists (merged?); skipping for ${chatJid}`)
      return null
    }

    return this.prisma.chatMember.upsert({
      where: { chatJid_identityId: { chatJid, identityId } },
      update: { role },
      create: { chatJid, identityId, role }
    })
  }

  /**
   * Delete a group member row.
   */
  async deleteChatMember(chatJid: string, identityId: number): Promise<ChatMember | null> {
    try {
      return await this.prisma.chatMember.delete({
        where: { chatJid_identityId: { chatJid, identityId } }
      })
    } catch (err) {
      return null
    }
  }

  /**
   * Fetch all member records for a group.
   */
  async findChatMembers(chatJid: string): Promise<ChatMemberWithIdentity[]> {
    const members = await this.prisma.chatMember.findMany({
      where: { chatJid },
      include: { identity: true }
    })
    return members as ChatMemberWithIdentity[]
  }
}
