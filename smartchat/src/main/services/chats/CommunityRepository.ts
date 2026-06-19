import { PrismaClient, Community } from '@prisma/client'
import { ICommunityRepository } from './ICommunityRepository'

/**
 * CommunityRepository — Encapsulates database operations for the Community table.
 */
export class CommunityRepository implements ICommunityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert a community row.
   */
  async upsertCommunity(jid: string, name: string | null): Promise<Community> {
    return this.prisma.community.upsert({
      where: { jid },
      update: name ? { name } : {},
      create: { jid, name }
    })
  }

  /**
   * Update the announce JID for a community.
   */
  async updateCommunityAnnounceJid(id: number, announceJid: string): Promise<Community> {
    return this.prisma.community.update({
      where: { id },
      data: { announceJid }
    })
  }
}
