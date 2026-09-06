import { PrismaClient } from '@prisma/client'
import { IMessageVectorRepository } from './IMessageVectorRepository'

export class MessageVectorRepository implements IMessageVectorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private static readonly VECTOR_MATCH_K = 30
  // Kept well under SQLite's host-parameter limit (999 on older builds) so the
  // `messageId IN (...)` scope filter can always be applied — chunked for larger
  // candidate sets rather than silently dropped.
  private static readonly CANDIDATE_CHUNK_SIZE = 900

  /**
   * Performs the native vector MATCH query against the vec_messages table.
   *
   * When `candidateIds` is supplied the search is always scoped to that set. For
   * sets larger than one SQL statement can bind, the query is run per-chunk and
   * the per-chunk KNN results are merged and re-ranked (each chunk's true
   * nearest-K is a superset of any global nearest-K member from that chunk, so
   * the merged top-K is correct).
   */
  async searchVectorMatch(
    queryVectorJson: string,
    candidateIds?: string[]
  ): Promise<Array<{ messageId: string; distance: number }>> {
    const K = MessageVectorRepository.VECTOR_MATCH_K

    if (!candidateIds || candidateIds.length === 0) {
      return this.runVectorMatch(queryVectorJson)
    }

    if (candidateIds.length <= MessageVectorRepository.CANDIDATE_CHUNK_SIZE) {
      return this.runVectorMatch(queryVectorJson, candidateIds)
    }

    const merged: Array<{ messageId: string; distance: number }> = []
    for (let i = 0; i < candidateIds.length; i += MessageVectorRepository.CANDIDATE_CHUNK_SIZE) {
      const chunk = candidateIds.slice(i, i + MessageVectorRepository.CANDIDATE_CHUNK_SIZE)
      merged.push(...(await this.runVectorMatch(queryVectorJson, chunk)))
    }
    merged.sort((a, b) => a.distance - b.distance)
    return merged.slice(0, K)
  }

  private runVectorMatch(
    queryVectorJson: string,
    candidateIds?: string[]
  ): Promise<Array<{ messageId: string; distance: number }>> {
    const params: unknown[] = [queryVectorJson]
    let filterSql = ''
    if (candidateIds && candidateIds.length > 0) {
      filterSql = `AND messageId IN (${candidateIds.map(() => '?').join(',')})`
      params.push(...candidateIds)
    }

    const sql = `
      SELECT messageId, distance
      FROM vec_messages
      WHERE vector MATCH ?
      ${filterSql}
      AND k = ${MessageVectorRepository.VECTOR_MATCH_K}
      ORDER BY distance ASC
    `
    return this.prisma.$queryRawUnsafe<Array<{ messageId: string; distance: number }>>(sql, ...params)
  }

  async upsertVector(messageId: string, vectorJson: string): Promise<void> {
    await this.prisma.messageVector.upsert({
      where: { messageId },
      create: { messageId, vector: vectorJson },
      update: { vector: vectorJson }
    })
  }

  async deleteFromVecMessages(messageId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(`DELETE FROM vec_messages WHERE messageId = ?`, messageId)
  }

  async insertIntoVecMessages(messageId: string, vectorJson: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO vec_messages(messageId, vector) VALUES (?, ?)`,
      messageId,
      vectorJson
    )
  }

  async getAllIndexedMessageIds(): Promise<string[]> {
    const indexed = await this.prisma.messageVector.findMany({ select: { messageId: true } })
    return indexed.map((v) => v.messageId)
  }

  async clearAllVectors(): Promise<void> {
    await this.prisma.messageVector.deleteMany({})
    await this.prisma.$executeRawUnsafe(`DELETE FROM vec_messages`)
  }

  async getAllVectors(): Promise<Array<{ messageId: string; vector: string }>> {
    return this.prisma.messageVector.findMany()
  }

  async deleteVector(messageId: string): Promise<void> {
    await this.prisma.messageVector.delete({ where: { messageId } })
  }
}
