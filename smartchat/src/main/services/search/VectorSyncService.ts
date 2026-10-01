import { IMessageVectorRepository } from '../messages/IMessageVectorRepository'
import { IVectorSyncService } from './IVectorSyncService'
import { EMBEDDING_DIMENSIONS } from './embeddingDimensions'

export class VectorSyncService implements IVectorSyncService {
  constructor(
    private readonly messageVectorRepository: IMessageVectorRepository
  ) {}

  public async sync(): Promise<void> {
    const vectors = await this.messageVectorRepository.getAllVectors()
    console.log(`[VectorSyncService] Syncing ${vectors.length} vectors to virtual table...`)
    for (const v of vectors) {
      try {
        const parsed = JSON.parse(v.vector)
        if (Array.isArray(parsed) && parsed.length !== EMBEDDING_DIMENSIONS) {
          console.warn(
            `[VectorSyncService] Dimension mismatch for message ${v.messageId} (expected ${EMBEDDING_DIMENSIONS}, got ${parsed.length}). Deleting stale vector.`
          )
          await this.messageVectorRepository.deleteVector(v.messageId).catch((err) => {
            console.error(
              `[VectorSyncService] Failed to delete stale vector for ${v.messageId}:`,
              err
            )
          })
          continue
        }
        await this.messageVectorRepository.deleteFromVecMessages(v.messageId)
        await this.messageVectorRepository.insertIntoVecMessages(v.messageId, v.vector)
      } catch (err) {
        console.error(`[VectorSyncService] Error syncing vector for ${v.messageId}:`, err)
      }
    }
    console.log('[VectorSyncService] Sync complete.')
  }
}
