import { PrismaClient, IdentityAlias } from '@prisma/client'
import {
  IAliasRepository,
  IdentityAliasWithIdentity,
  IdentityAliasMinimal
} from './IAliasRepository'

export class AliasRepository implements IAliasRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findIdentityAlias(jid: string): Promise<IdentityAlias | null> {
    return this.prisma.identityAlias.findUnique({
      where: { jid }
    })
  }

  async findLidAliasByIdentityId(identityId: number): Promise<IdentityAlias | null> {
    return this.prisma.identityAlias.findFirst({
      where: { identityId, type: 'LID' }
    })
  }

  async findAllAliases(): Promise<IdentityAlias[]> {
    return this.prisma.identityAlias.findMany()
  }

  async findIdentityAliases(jids: string[]): Promise<IdentityAliasWithIdentity[]> {
    if (jids.length === 0) return []
    const aliases = await this.prisma.identityAlias.findMany({
      where: { jid: { in: jids } },
      include: { identity: true }
    })
    return aliases as IdentityAliasWithIdentity[]
  }

  async findIdentityAliasesMinimal(jids: string[]): Promise<IdentityAliasMinimal[]> {
    if (jids.length === 0) return []
    return this.prisma.identityAlias.findMany({
      where: { jid: { in: jids } },
      select: { jid: true, identityId: true }
    })
  }

  async upsertIdentityAlias(jid: string, type: string, identityId: number): Promise<IdentityAlias> {
    return this.prisma.identityAlias.upsert({
      where: { jid },
      update: { identityId, type },
      create: { jid, type, identityId }
    })
  }
}
