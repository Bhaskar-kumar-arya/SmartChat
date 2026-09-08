import { PrismaClient, Identity } from '@prisma/client'
import {
  IIdentityRepository,
  IdentityCreateInput,
  IdentityUpdateInput,
  IdentityWithAliases,
  ReferenceCounts
} from './IIdentityRepository'

export class IdentityRepository implements IIdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMeIdentity(): Promise<IdentityWithAliases | null> {
    return this.prisma.identity.findFirst({
      where: { isMe: true },
      include: { aliases: true }
    })
  }

  async findIdentityByPhoneNumber(phoneNumber: string): Promise<Identity | null> {
    return this.prisma.identity.findUnique({
      where: { phoneNumber }
    })
  }

  async findIdentityById(id: number): Promise<Identity | null> {
    return this.prisma.identity.findUnique({
      where: { id }
    })
  }

  async createIdentity(data: IdentityCreateInput): Promise<Identity> {
    return this.prisma.identity.create({ data })
  }

  async updateIdentity(id: number, data: IdentityUpdateInput): Promise<Identity> {
    return this.prisma.identity.update({
      where: { id },
      data
    })
  }

  async deleteIdentity(id: number): Promise<Identity> {
    return this.prisma.identity.delete({
      where: { id }
    })
  }

  async mergeIdentityInto(fromId: number, toId: number): Promise<void> {
    if (fromId === toId) return

    await this.prisma.$transaction(async (tx) => {
      const from = await tx.identity.findUnique({ where: { id: fromId } })
      const to = await tx.identity.findUnique({ where: { id: toId } })
      if (!from || !to) return

      // 1. Re-point all aliases from source → target
      await tx.identityAlias.updateMany({
        where: { identityId: fromId },
        data: { identityId: toId }
      })

      // 2. Re-point messages
      await tx.message.updateMany({
        where: { senderId: fromId },
        data: { senderId: toId }
      })

      // 3. Merge ChatMember rows — handle composite PK conflicts
      const fromMemberships = await tx.chatMember.findMany({ where: { identityId: fromId } })
      for (const m of fromMemberships) {
        const conflict = await tx.chatMember.findUnique({
          where: { chatJid_identityId: { chatJid: m.chatJid, identityId: toId } }
        })
        if (conflict) {
          await tx.chatMember.delete({
            where: { chatJid_identityId: { chatJid: m.chatJid, identityId: fromId } }
          })
        } else {
          await tx.chatMember.update({
            where: { chatJid_identityId: { chatJid: m.chatJid, identityId: fromId } },
            data: { identityId: toId }
          })
        }
      }

      // 4. Merge Reactions — handle composite PK conflicts
      const fromReactions = await tx.reaction.findMany({ where: { senderId: fromId } })
      for (const r of fromReactions) {
        const conflict = await tx.reaction.findUnique({
          where: { messageId_senderId: { messageId: r.messageId, senderId: toId } }
        })
        if (conflict) {
          await tx.reaction.delete({
            where: { messageId_senderId: { messageId: r.messageId, senderId: fromId } }
          })
        } else {
          await tx.reaction.update({
            where: { messageId_senderId: { messageId: r.messageId, senderId: fromId } },
            data: { senderId: toId }
          })
        }
      }

      // 5. Enrich the survivor with any unique data the source held
      const enrichUpdate: {
        displayName?: string | null
        verifiedName?: string | null
        pushName?: string | null
        profilePictureUrl?: string | null
      } = {}
      if (!to.displayName && from.displayName) enrichUpdate.displayName = from.displayName
      if (!to.verifiedName && from.verifiedName) enrichUpdate.verifiedName = from.verifiedName
      if (!to.pushName && from.pushName) enrichUpdate.pushName = from.pushName
      if (!to.profilePictureUrl && from.profilePictureUrl)
        enrichUpdate.profilePictureUrl = from.profilePictureUrl
      if (Object.keys(enrichUpdate).length > 0) {
        await tx.identity.update({ where: { id: toId }, data: enrichUpdate })
      }

      // 6. Delete the now-empty source identity
      await tx.identity.delete({ where: { id: fromId } })
    })
  }

  async countIdentityReferences(id: number): Promise<ReferenceCounts> {
    const [aliases, messages, members, reactions] = await Promise.all([
      this.prisma.identityAlias.count({ where: { identityId: id } }),
      this.prisma.message.count({ where: { senderId: id } }),
      this.prisma.chatMember.count({ where: { identityId: id } }),
      this.prisma.reaction.count({ where: { senderId: id } })
    ])
    return { aliases, messages, members, reactions }
  }

  async searchIdentities(query: string, take: number = 20): Promise<IdentityWithAliases[]> {
    return this.prisma.identity.findMany({
      where: {
        OR: [
          { displayName: { contains: query } },
          { pushName: { contains: query } },
          { verifiedName: { contains: query } },
          { phoneNumber: { contains: query } }
        ]
      },
      include: {
        aliases: true
      },
      take
    }) as Promise<IdentityWithAliases[]>
  }
}
