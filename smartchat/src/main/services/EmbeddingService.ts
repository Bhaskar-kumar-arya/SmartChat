import { app } from 'electron'
import path from 'path'
import { prisma } from '../auth'

// ── SRP: this service ONLY handles embedding generation, storage and retrieval ──

export interface IEmbeddingService {
  embed(text: string): Promise<number[]>
  indexMessage(messageId: string, text: string): Promise<void>
  indexAll(onProgress?: (pct: number) => void): Promise<void>
  clearAllVectors(): Promise<void>
  setModel(modelName: string): void
  getModel(): string
}

/**
 * EmbeddingService generates 768-dim sentence vectors using
 * @xenova/transformers (bhasha-embed-onnx-quantized).
 *
 * The model runs entirely locally (no API key). On first call it is
 * downloaded once (~25MB) and cached in userData/models.
 */
export class EmbeddingService implements IEmbeddingService {
  private pipeline: any = null
  private loadPromise: Promise<void> | null = null

  // -----------------------------------------------------------------
  // Model loading (lazy + cached)
  // -----------------------------------------------------------------

  private modelName = 'bhasha-embed-onnx-quantized' //'Xenova/paraphrase-multilingual-MiniLM-L12-v2' // Correct Hub ID for online models

  public setModel(name: string): void {
    if (this.modelName !== name) {
      this.modelName = name
      this.pipeline = null
      this.loadPromise = null
      console.log(`[EmbeddingService] Model changed to: ${name}. It will be loaded on next use.`)
    }
  }

  public getModel(): string {
    return this.modelName
  }

  private async loadModel(): Promise<void> {
    if (this.pipeline) return
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = (async () => {
      try {
        // Dynamic import so the heavy ONNX runtime only loads when needed
        const { pipeline, env } = await import('@xenova/transformers')

        // Cache models in userData so they survive app updates
        const modelCacheDir = path.join(app.getPath('userData'), 'models')
        env.cacheDir = modelCacheDir

        // Determine where our locally bundled models are
        const localModelsRoot = path.join(app.getAppPath(), 'src', 'main', 'models')

        // Environment settings for Electron Main process (standard Node.js vs Browser)
        env.localModelPath = localModelsRoot
        env.allowLocalModels = true
        env.allowRemoteModels = true

        // Ensure standard fetch works in Node.js (some older versions needed custom fetch, but modern Electron is fine)
        // If we want to use specific HF models, they usually need to be in the "Xenova" or "sentence-transformers" org
        // The previous error was due to an incomplete Hub ID (paraphrase-multilingual-MiniLM-L12-v2 vs Xenova/paraphrase-multilingual-MiniLM-L12-v2)

        console.log(`[EmbeddingService] Loading model: ${this.modelName} (Local Path: ${localModelsRoot})`)

        try {
          // Load the pipeline. 
          // If 'this.modelName' refers to a folder in 'localModelsRoot', it loads locally.
          // Otherwise, it tries to download from the Hugging Face hub (requires proper Hub ID).
          this.pipeline = await pipeline('feature-extraction', this.modelName, {
            quantized: true,
            // Add progress callback for online models
            progress_callback: (p: any) => {
              if (p.status === 'progress') {
                console.log(`[EmbeddingService] Downloading model: ${p.file} (${Math.round(p.loaded / p.total * 100)}%)`)
              }
            }
          })
          console.log(`[EmbeddingService] Model '${this.modelName}' loaded successfully.`)
        } catch (pipeErr) {
          console.error(`[EmbeddingService] Failed to load model through pipeline:`, pipeErr)
          // Fallback logic if the primary model fails (e.g., try another known local model)
          if (this.modelName !== 'bhasha-embed-onnx-quantized') {
            console.log('[EmbeddingService] Falling back to default local model...')
            this.modelName = 'bhasha-embed-onnx-quantized'
            this.pipeline = await pipeline('feature-extraction', this.modelName, { quantized: true })
          } else {
            throw pipeErr
          }
        }
      } catch (err) {
        console.error('[EmbeddingService] Fatal error loading model:', err)
        throw err
      }
    })()

    return this.loadPromise
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------

  /**
   * Generates a 768-dim embedding vector for a given text string.
   */
  async embed(text: string): Promise<number[]> {
    await this.loadModel()
    const output = await this.pipeline(text, { pooling: 'mean', normalize: true })
    // output.data is a Float32Array
    return Array.from(output.data as Float32Array)
  }

  /**
   * Compute cosine similarity between two 768-dim vectors.
   * Both vectors are expected to be unit-normalised.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
    return dot // normalised vectors: cos(θ) = a·b
  }

  // -----------------------------------------------------------------
  // Queued Indexing logic to prevent main thread blocking
  // -----------------------------------------------------------------

  private indexQueue: Array<{ messageId: string; text: string }> = []
  private isProcessingQueue = false

  /**
   * Persist the embedding for a single message (queued).
   * We use a queue to ensure we don't saturate the CPU with multiple 
   * concurrent transformer inferences in the main process.
   */
  async indexMessage(messageId: string, text: string): Promise<void> {
    if (!text?.trim()) return
    this.indexQueue.push({ messageId, text })

    // We don't await the entire queue drain here to keep it non-blocking for real-time
    this.processQueue()
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.indexQueue.length === 0) return
    this.isProcessingQueue = true

    while (this.indexQueue.length > 0) {
      const item = this.indexQueue.shift()
      if (!item) continue

      try {
        const { messageId, text } = item
        const vector = await this.embed(text)
        const vectorJson = JSON.stringify(vector)

        // 1. Prisma storage (Standard table)
        await (prisma as any).messageVector.upsert({
          where: { messageId },
          create: { messageId, vector: vectorJson },
          update: { vector: vectorJson }
        })

        // 2. Vector extension storage (Virtual table for fast search)
        await prisma.$executeRawUnsafe(
          `INSERT OR REPLACE INTO vec_messages(messageId, vector) VALUES (?, ?)`,
          messageId,
          vectorJson
        )
      } catch (err) {
        console.error(`[EmbeddingService] Failed to index message:`, err)
      }

      // Yield to event loop with a minimal breather
      if (this.indexQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }

    this.isProcessingQueue = false
  }

  /**
   * Index ALL messages that have textContent but no existing vector.
   * Processes sequentially to ensure accuracy and progress reporting.
   * Calls onProgress with 0–100 integer.
   */
  async indexAll(onProgress?: (pct: number) => void): Promise<void> {
    // Ensure model is loaded first
    await this.loadModel()

    // Find message IDs that are already indexed
    const indexed = await (prisma as any).messageVector.findMany({ select: { messageId: true } })
    const indexedSet = new Set<string>(indexed.map((v: any) => v.messageId))

    // Fetch all messages with text that haven't been indexed
    const messages = await prisma.message.findMany({
      where: { textContent: { not: null } },
      select: { id: true, textContent: true }
    })

    const pending = messages.filter((m) => !indexedSet.has(m.id) && m.textContent?.trim())
    const total = pending.length

    if (total === 0) {
      onProgress?.(100)
      return
    }

    console.log(`[EmbeddingService] Starting bulk indexing for ${total} messages...`)

    let done = 0
    for (const m of pending) {
      try {
        const vector = await this.embed(m.textContent!)
        const vectorJson = JSON.stringify(vector)

        await (prisma as any).messageVector.upsert({
          where: { messageId: m.id },
          create: { messageId: m.id, vector: vectorJson },
          update: { vector: vectorJson }
        })

        await prisma.$executeRawUnsafe(
          `INSERT OR REPLACE INTO vec_messages(messageId, vector) VALUES (?, ?)`,
          m.id,
          vectorJson
        )
      } catch (err) {
        console.error(`[EmbeddingService] Failed to index message ${m.id}:`, err)
      }

      done++
      if (done % 5 === 0 || done === total) {
        onProgress?.(Math.round((done / total) * 100))
      }

      // Small breather every few messages to keep Main process responsive
      if (done % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }

    console.log(`[EmbeddingService] Bulk indexing complete.`)
  }

  async clearAllVectors(): Promise<void> {
    await (prisma as any).messageVector.deleteMany({})
    await prisma.$executeRawUnsafe(`DELETE FROM vec_messages`)
    console.log('[EmbeddingService] All vectors cleared.')
  }

  /**
   * Syncs existing vectors from the standard MessageVector table to the 
   * sqlite-vec specialized virtual table. Useful after first update.
   */
  async syncVectors(): Promise<void> {
    console.log('[EmbeddingService] Syncing vectors to virtual table...')
    const all = await (prisma as any).messageVector.findMany()
    console.log(`[EmbeddingService] Found ${all.length} vectors to sync.`)
    
    // Batch inserts for performance
    const BATCH_SIZE = 100
    for (let i = 0; i < all.length; i += BATCH_SIZE) {
      const batch = all.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(v => 
        prisma.$executeRawUnsafe(
          `INSERT OR REPLACE INTO vec_messages(messageId, vector) VALUES (?, ?)`,
          v.messageId,
          v.vector
        )
      ))
      if (i % 500 === 0) console.log(`[EmbeddingService] Synced ${i} vectors...`)
    }
    console.log('[EmbeddingService] Vector sync complete.')
  }
}

export const embeddingService = new EmbeddingService()
