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
 * EmbeddingService generates 384-dim sentence vectors using
 * @xenova/transformers all-MiniLM-L6-v2.
 *
 * The model runs entirely locally (no API key). On first call it is
 * downloaded once (~25MB) and cached in userData/models.
 */
export class EmbeddingService implements IEmbeddingService {
  private pipeline: any = null
  private isLoading = false
  private loadPromise: Promise<void> | null = null

  // -----------------------------------------------------------------
  // Model loading (lazy + cached)
  // -----------------------------------------------------------------

  private modelName =  'bhasha-embed-onnx-quantized' //'Xenova/paraphrase-multilingual-MiniLM-L12-v2' // Correct Hub ID for online models

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
      this.isLoading = true
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
      } finally {
        this.isLoading = false
      }
    })()

    return this.loadPromise
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------

  /**
   * Generates a 384-dim embedding vector for a given text string.
   */
  async embed(text: string): Promise<number[]> {
    await this.loadModel()
    const output = await this.pipeline(text, { pooling: 'mean', normalize: true })
    // output.data is a Float32Array
    return Array.from(output.data as Float32Array)
  }

  /**
   * Compute cosine similarity between two 384-dim vectors.
   * Both vectors are expected to be unit-normalised (all-MiniLM-L6-v2 outputs are).
   */
  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
    return dot // normalised vectors: cos(θ) = a·b
  }

  /**
   * Persist the embedding for a single message (upsert).
   */
  async indexMessage(messageId: string, text: string): Promise<void> {
    if (!text?.trim()) return
    try {
      const vector = await this.embed(text)
      await (prisma as any).messageVector.upsert({
        where: { messageId },
        create: { messageId, vector: JSON.stringify(vector) },
        update: { vector: JSON.stringify(vector) }
      })
    } catch (err) {
      console.error(`[EmbeddingService] Failed to index message ${messageId}:`, err)
    }
  }

  /**
   * Index ALL messages that have textContent but no existing vector.
   * Processes in batches of 50 to keep the process responsive.
   * Calls onProgress with 0–100 integer.
   */
  async indexAll(onProgress?: (pct: number) => void): Promise<void> {
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

    const BATCH = 50
    let done = 0

    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH)
      await Promise.all(batch.map((m) => this.indexMessage(m.id, m.textContent!)))
      done += batch.length
      onProgress?.(Math.round((done / total) * 100))
    }
  }

  async clearAllVectors(): Promise<void> {
    await (prisma as any).messageVector.deleteMany({})
    console.log('[EmbeddingService] All vectors cleared.')
  }
}

export const embeddingService = new EmbeddingService()
