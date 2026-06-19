import { PrismaClient, LidMap } from '@prisma/client'
import { ILidMapRepository } from './ILidMapRepository'

export class LidMapRepository implements ILidMapRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findLidMap(pn: string): Promise<LidMap | null> {
    return this.prisma.lidMap.findFirst({
      where: { pn }
    })
  }

  async findLidMaps(lids: string[]): Promise<LidMap[]> {
    if (lids.length === 0) return []
    return this.prisma.lidMap.findMany({
      where: { lid: { in: lids } }
    })
  }

  async upsertLidMap(lid: string, pn: string, source: string): Promise<LidMap> {
    return this.prisma.lidMap.upsert({
      where: { lid },
      update: { pn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) },
      create: { lid, pn, source, lastSeenDateTime: BigInt(Math.floor(Date.now() / 1000)) }
    })
  }
}
