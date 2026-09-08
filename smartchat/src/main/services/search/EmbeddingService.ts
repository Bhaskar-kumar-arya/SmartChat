import { IMessageVectorRepository } from '../messages/IMessageVectorRepository'
import { IMessageIndexRepository } from '../messages/IMessageIndexRepository'
import { IEmbeddingWorkerManager } from './IEmbeddingWorkerManager'
import { IEmbeddingService } from './IEmbeddingService'

// ── SRP: this service ONLY handles embedding generation coordination, storage and retrieval ──


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
    private readonly messageQueryRepository: IMessageIndexRepository,
    workerManager: IEmbeddingWorkerManager
  ) {
    this.workerManager = workerManager
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
      // S11-04: re-check pause each iteration — a setPaused(true) that arrives
      // mid-drain (WhatsApp history sync starting) must stop embedding work
      // now, not after the whole queue is exhausted. The item stays queued and
      // resumes on setPaused(false) → processQueue().
      if (this.isPaused) break

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
    
    // P2-S11-01: if the embedding model can't load, fail loudly here instead of
    // walking the whole message table logging one error per row (and never
    // persisting anything useful).
    try {
      await this.workerManager.ensureWorker(this.modelName)
    } catch (err) {
      console.error('[EmbeddingService] Bulk indexing aborted — embedding model unavailable:', err)
      throw err instanceof Error ? err : new Error(String(err))
    }

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
        // S11-04: stop the bulk pass promptly when a history sync pauses us.
        if (this.isPaused) {
          console.warn('[EmbeddingService] Bulk indexing interrupted by pause; remaining messages will be picked up later.')
          break
        }
        if (!m.textContent) continue
        try {
          const vector = await this.embed(m.textContent)
          const vectorJson = JSON.stringify(vector)

          await this.messageVectorRepository.upsertVector(m.id, vectorJson)

          await this.messageVectorRepository.deleteFromVecMessages(m.id)
          await this.messageVectorRepository.insertIntoVecMessages(m.id, vectorJson)
        } catch (err) {
          console.error(`[EmbeddingService] Failed to index message ${m.id}:`, err)
          // P2-S11-01: a failed embed here means the worker/model is down for
          // this run — bail rather than logging thousands of identical errors.
          if (err instanceof Error && /worker|model/i.test(err.message)) {
            console.error('[EmbeddingService] Bulk indexing aborted mid-run (embedding worker unavailable).')
            break
          }
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
}

