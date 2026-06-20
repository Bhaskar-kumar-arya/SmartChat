import { IMessageVectorRepository } from '../messages/IMessageVectorRepository'
import { IMessageQueryRepository } from '../messages/IMessageQueryRepository'
import { IEmbeddingWorkerManager } from './IEmbeddingWorkerManager'

// ── SRP: this service ONLY handles embedding generation coordination, storage and retrieval ──

export interface IEmbeddingService {
  embed(text: string): Promise<number[]>
  indexMessage(messageId: string, text: string): Promise<void>
  indexAll(onProgress?: (pct: number) => void): Promise<void>
  clearAllVectors(): Promise<void>
  syncVectors(): Promise<void>
  setModel(modelName: string): void
  getModel(): string
  setPaused(paused: boolean): void
  setOnActiveStateSync(cb: (isActive: boolean) => void): void
}

/**
 * EmbeddingService coordinates embedding generation using a separate Worker thread
 * to keep the Main process responsive.
 */
export class EmbeddingService implements IEmbeddingService {
  private readonly workerManager: IEmbeddingWorkerManager
  private isPaused = false
  private modelName = 'Xenova/all-MiniLM-L6-v2'
  private onActiveStateChange?: (isActive: boolean) => void
  private activeJobs = 0

  constructor(
    private readonly messageVectorRepository: IMessageVectorRepository,
    private readonly messageQueryRepository: IMessageQueryRepository,
    workerManager?: IEmbeddingWorkerManager
  ) {
    if (workerManager) {
      this.workerManager = workerManager
    } else {
      // Fallback for Phase 4-6 until Phase 7 wires the manager in ServiceContainer.ts
      const { app } = require('electron')
      const path = require('path')
      const { EmbeddingWorkerManager } = require('./EmbeddingWorkerManager')
      
      const config = {
        workerPath: path.join(__dirname, 'embedding.worker.js'),
        modelCacheDir: path.join(app.getPath('userData'), 'models'),
        localModelsRoot: path.join(app.getAppPath(), 'src', 'main', 'models')
      }
      this.workerManager = new EmbeddingWorkerManager(config)
    }
  }

  public setOnActiveStateSync(cb: (isActive: boolean) => void): void {
    this.onActiveStateChange = cb
  }

  private updateActiveState(delta: number): void {
    const wasActive = this.activeJobs > 0
    this.activeJobs = Math.max(0, this.activeJobs + delta)
    const isActive = this.activeJobs > 0
    
    if (wasActive !== isActive && this.onActiveStateChange) {
      this.onActiveStateChange(isActive)
    }
  }

  public setModel(name: string): void {
    if (this.modelName !== name) {
      this.modelName = name
      this.workerManager.setModel(name)
      console.log(`[EmbeddingService] Model changed to: ${name}.`)
    }
  }

  public getModel(): string {
    return this.modelName
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused
    if (!paused) {
      this.processQueue()
    }
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------

  async embed(text: string): Promise<number[]> {
    this.updateActiveState(1)
    try {
      await this.workerManager.ensureWorker(this.modelName)
      return await this.workerManager.embed(text)
    } finally {
      this.updateActiveState(-1)
    }
  }

  // -----------------------------------------------------------------
  // Queued Indexing logic
  // -----------------------------------------------------------------

  private indexQueue: Array<{ messageId: string; text: string }> = []
  private isProcessingQueue = false

  async indexMessage(messageId: string, text: string): Promise<void> {
    if (!text?.trim()) return
    this.indexQueue.push({ messageId, text })
    this.processQueue()
  }

  private async processQueue(): Promise<void> {
    if (this.isPaused || this.isProcessingQueue || this.indexQueue.length === 0) return
    this.isProcessingQueue = true

    while (this.indexQueue.length > 0) {
      const item = this.indexQueue.shift()
      if (!item) continue

      try {
        const { messageId, text } = item
        const vector = await this.embed(text)
        const vectorJson = JSON.stringify(vector)

        await this.messageVectorRepository.upsertVector(messageId, vectorJson)

        await this.messageVectorRepository.deleteFromVecMessages(messageId)
        await this.messageVectorRepository.insertIntoVecMessages(messageId, vectorJson)
      } catch (err) {
        console.error(`[EmbeddingService] Failed to index message:`, err)
      }

      if (this.indexQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    }

    this.isProcessingQueue = false
  }

  async indexAll(onProgress?: (pct: number) => void): Promise<void> {
    if (this.isPaused) {
      console.warn('[EmbeddingService] Bulk indexing deferred: history sync in progress.')
      return
    }
    
    await this.workerManager.ensureWorker(this.modelName)

    const indexedIds = await this.messageVectorRepository.getAllIndexedMessageIds()
    const indexedSet = new Set<string>(indexedIds)

    const messages = await this.messageQueryRepository.findMessagesWithTextContent()

    const pending = messages.filter((m) => !indexedSet.has(m.id) && m.textContent?.trim())
    const total = pending.length

    if (total === 0) {
      onProgress?.(100)
      return
    }

    console.log(`[EmbeddingService] Starting bulk indexing for ${total} messages...`)
    this.updateActiveState(1)

    try {
      let done = 0
      for (const m of pending) {
        try {
          const vector = await this.embed(m.textContent!)
          const vectorJson = JSON.stringify(vector)

          await this.messageVectorRepository.upsertVector(m.id, vectorJson)

          await this.messageVectorRepository.deleteFromVecMessages(m.id)
          await this.messageVectorRepository.insertIntoVecMessages(m.id, vectorJson)
        } catch (err) {
          console.error(`[EmbeddingService] Failed to index message ${m.id}:`, err)
        }

        done++
        if (done % 5 === 0 || done === total) {
          onProgress?.(Math.round((done / total) * 100))
        }
      }
    } finally {
      this.updateActiveState(-1)
      console.log(`[EmbeddingService] Bulk indexing complete.`)
    }
  }

  async clearAllVectors(): Promise<void> {
    await this.messageVectorRepository.clearAllVectors()
    console.log('[EmbeddingService] All vectors cleared.')
  }

  async syncVectors(): Promise<void> {
    const vectors = await this.messageVectorRepository.getAllVectors()
    console.log(`[EmbeddingService] Syncing ${vectors.length} vectors to virtual table...`)
    for (const v of vectors) {
      try {
        const parsed = JSON.parse(v.vector)
        if (Array.isArray(parsed) && parsed.length !== 768) {
          console.warn(`[EmbeddingService] Dimension mismatch for message ${v.messageId} (expected 768, got ${parsed.length}). Deleting stale vector.`)
          await this.messageVectorRepository.deleteVector(v.messageId).catch((err) => {
            console.error(`[EmbeddingService] Failed to delete stale vector for ${v.messageId}:`, err)
          })
          continue
        }
        await this.messageVectorRepository.deleteFromVecMessages(v.messageId)
        await this.messageVectorRepository.insertIntoVecMessages(v.messageId, v.vector)
      } catch (err) {
        console.error(`[EmbeddingService] Error syncing vector for ${v.messageId}:`, err)
      }
    }
    console.log('[EmbeddingService] Sync complete.')
  }
}

