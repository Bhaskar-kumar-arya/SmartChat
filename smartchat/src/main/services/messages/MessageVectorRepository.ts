import { PrismaClient } from '@prisma/client'
import { IMessageVectorRepository } from './IMessageVectorRepository'

export class MessageVectorRepository implements IMessageVectorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Performs the native vector MATCH query against the vec_messages table.
   */
  async searchVectorMatch(
    queryVectorJson: string,
    candidateIds?: string[]
  ): Promise<Array<{ messageId: string; distance: number }>> {
    let filterSql = ''
    const params: any[] = [queryVectorJson]

    if (candidateIds && candidateIds.length > 0) {
      if (candidateIds.length < 2000) {
        filterSql = `AND messageId IN (${candidateIds.map(() => '?').join(',')})`
        params.push(...candidateIds)
      }
    }

    const sql = `
      SELECT messageId, distance
      FROM vec_messages
      WHERE vector MATCH ?
      ${filterSql}
      AND k = 30
      ORDER BY distance ASC
    `
    return this.prisma.$queryRawUnsafe<Array<{ messageId: string; distance: number }>>(sql, ...params)
  }
}
