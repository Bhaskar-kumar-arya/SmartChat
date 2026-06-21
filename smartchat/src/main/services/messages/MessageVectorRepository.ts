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
    const params: unknown[] = [queryVectorJson]

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
