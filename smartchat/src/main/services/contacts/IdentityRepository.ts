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
