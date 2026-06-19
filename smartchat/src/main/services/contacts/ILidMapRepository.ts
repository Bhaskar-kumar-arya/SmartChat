import { LidMap } from '@prisma/client'

export interface ILidMapRepository {
  findLidMap(pn: string): Promise<LidMap | null>
  findLidMaps(lids: string[]): Promise<LidMap[]>
  upsertLidMap(lid: string, pn: string, source: string): Promise<LidMap>
}
