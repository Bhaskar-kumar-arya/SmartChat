import { PrismaClient, Identity, IdentityAlias, LidMap } from '@prisma/client'

export interface IdentityCreateInput {
  phoneNumber?: string | null
  displayName?: string | null
  pushName?: string | null
  verifiedName?: string | null
  profilePictureUrl?: string | null
  isMe?: boolean
}

export interface IdentityUpdateInput {
  phoneNumber?: string | null
  displayName?: string | null
  pushName?: string | null
  verifiedName?: string | null
  profilePictureUrl?: string | null
  isMe?: boolean
}

export interface IdentityWithAliases extends Identity {
  aliases: IdentityAlias[]
}

export interface IdentityAliasWithIdentity extends IdentityAlias {
  identity: Identity | null
}

export interface IdentityAliasMinimal {
  jid: string
  identityId: number
}

export interface ReferenceCounts {
  aliases: number
  messages: number
  members: number
  reactions: number
}

/**
 * ContactRepository — Encapsulates all read and write database operations
 * for the Identity, IdentityAlias, and LidMap tables.
 */
export class ContactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find the user's identity row (`isMe: true`) with its aliases.
   */
  async findMeIdentity(): Promise<IdentityWithAliases | null> {
    return this.prisma.identity.findFirst({
      where: { isMe: true },
      include: { aliases: true }
    })
  }

  /**
   * Find a single identity by phone number.
   */
  async findIdentityByPhoneNumber(phoneNumber: string): Promise<Identity | null> {
    return this.prisma.identity.findUnique({
      where: { phoneNumber }
    })
  }

  /**
   * Find a single identity by ID.
   */
  async findIdentityById(id: number): Promise<Identity | null> {
    return this.prisma.identity.findUnique({
      where: { id }
    })
  }

  /**
   * Find an IdentityAlias row by JID.
   */
  async findIdentityAlias(jid: string): Promise<IdentityAlias | null> {
    return this.prisma.identityAlias.findUnique({
      where: { jid }
    })
  }

  /**
   * Find the LID alias for a given identityId.
   */
  async findLidAliasByIdentityId(identityId: number): Promise<IdentityAlias | null> {
    return this.prisma.identityAlias.findFirst({
      where: { identityId, type: 'LID' }
    })
  }

  /**
   * Fetch all IdentityAlias rows in the database.
   */
  async findAllAliases(): Promise<IdentityAlias[]> {
    return this.prisma.identityAlias.findMany()
  }

  /**
   * Batch-find multiple aliases with their identities.
   */
  async findIdentityAliases(jids: string[]): Promise<IdentityAliasWithIdentity[]> {
    if (jids.length === 0) return []
    const aliases = await this.prisma.identityAlias.findMany({
      where: { jid: { in: jids } },
      include: { identity: true }
    })
    return aliases as IdentityAliasWithIdentity[]
  }

  /**
   * Batch-find multiple aliases returning only jid and identityId.
   */
  async findIdentityAliasesMinimal(jids: string[]): Promise<IdentityAliasMinimal[]> {
    if (jids.length === 0) return []
    return this.prisma.identityAlias.findMany({
      where: { jid: { in: jids } },
      select: { jid: true, identityId: true }
    })
  }

  /**
   * Find a LidMap entry by its phone number.
   */
  async findLidMap(pn: string): Promise<LidMap | null> {
    return this.prisma.lidMap.findFirst({
      where: { pn }
    })
  }

  /**
   * Batch-find multiple LidMap entries by LID.
   */
  async findLidMaps(lids: string[]): Promise<LidMap[]> {
    if (lids.length === 0) return []
    return this.prisma.lidMap.findMany({
      where: { lid: { in: lids } }
    })
  }

  /**
   * Insert a new identity row.
   */
  async createIdentity(data: IdentityCreateInput): Promise<Identity> {
    return this.prisma.identity.create({ data })
  }

  /**
   * Update an identity row.
   */
  async updateIdentity(id: number, data: IdentityUpdateInput): Promise<Identity> {
    return this.prisma.identity.update({
      where: { id },
      data
    })
  }

  /**
   * Upsert an IdentityAlias.
   */
  async upsertIdentityAlias(jid: string, type: string, identityId: number): Promise<IdentityAlias> {
    return this.prisma.identityAlias.upsert({
      where: { jid },
      update: { identityId, type },
      create: { jid, type, identityId }
    })
  }

  /**
   * Upsert a LID-to-PN mapping.
   */
  async upsertLidMap(lid: string, pn: string, source: string): Promise<LidMap> {
    return this.prisma.lidMap.upsert({
      where: { lid },
      update: { pn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) },
      create: { lid, pn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) }
    })
  }

  /**
   * Delete an identity row.
   */
  async deleteIdentity(id: number): Promise<Identity> {
    return this.prisma.identity.delete({
      where: { id }
    })
  }

  /**
   * Run aggregate queries to check aliases, messages, chat memberships, and reactions.
   */
  async countIdentityReferences(id: number): Promise<ReferenceCounts> {
    const [aliases, messages, members, reactions] = await Promise.all([
      this.prisma.identityAlias.count({ where: { identityId: id } }),
      this.prisma.message.count({ where: { senderId: id } }),
      this.prisma.chatMember.count({ where: { identityId: id } }),
      this.prisma.reaction.count({ where: { senderId: id } })
    ])
    return { aliases, messages, members, reactions }
  }

  /**
   * Search identities by display name, push name, verified name, or phone number.
   */
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

