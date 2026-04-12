import { app } from 'electron'
import path from 'path'
import { Worker } from 'worker_threads'
import { prisma } from '../auth'

// ── SRP: this service ONLY handles embedding generation coordination, storage and retrieval ──

export interface IEmbeddingService {
  embed(text: string): Promise<number[]>
  indexMessage(messageId: string, text: string): Promise<void>
  indexAll(onProgress?: (pct: number) => void): Promise<void>
  clearAllVectors(): Promise<void>
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
  private worker: Worker | null = null
  private workerJobCounter = 0
  private pendingJobs = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private initPromise: Promise<void> | null = null
  private isPaused = false
  private modelName = 'bhasha-embed-onnx-quantized'
  private onActiveStateChange?: (isActive: boolean) => void
  private activeJobs = 0

  constructor() {
    // We don't initialize the worker in constructor to avoid overhead if not used
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
      if (this.worker) {
        this.worker.postMessage({ type: 'setModel', payload: { modelName: name } })
      }
      console.log(`[EmbeddingService] Model changed to: ${name}.`)
    }
  }

  public getModel(): string {
    return this.modelName
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker) return
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      try {
        // Path logic: electron-vite builds main files into out/main/
        // Our worker is configured as 'embedding.worker' in electron.vite.config.ts
        const workerPath = path.join(__dirname, 'embedding.worker.js')
        
        console.log(`[EmbeddingService] Starting worker from: ${workerPath}`)
        this.worker = new Worker(workerPath)

        this.worker.on('message', (msg) => {
          if (msg.type === 'init_done') {
            console.log('[EmbeddingService] Worker initialized.')
            resolve()
          } else if (msg.type === 'progress') {
            const p = msg.payload
            if (p.status === 'progress') {
              console.log(`[EmbeddingService] Worker Download: ${p.file} (${Math.round((p.loaded / p.total) * 100)}%)`)
            }
          } else if (msg.type === 'embed_done') {
            const job = this.pendingJobs.get(msg.id)
            if (job) {
              job.resolve(msg.payload.vector)
              this.pendingJobs.delete(msg.id)
            }
          } else if (msg.type === 'error') {
            if (msg.id !== null) {
              const job = this.pendingJobs.get(msg.id)
              if (job) {
                job.reject(new Error(msg.payload.error))
                this.pendingJobs.delete(msg.id)
              }
            } else {
              console.error('[EmbeddingService] Worker Global Error:', msg.payload.error)
              reject(new Error(msg.payload.error))
            }
          }
        })

        this.worker.on('error', (err) => {
          console.error('[EmbeddingService] Worker Critical Error:', err)
          reject(err)
        })

        this.worker.on('exit', (code) => {
          if (code !== 0) console.error(`[EmbeddingService] Worker stopped with exit code ${code}`)
          this.worker = null
          this.initPromise = null
        })

        // Initialize model settings
        const modelCacheDir = path.join(app.getPath('userData'), 'models')
        const localModelsRoot = path.join(app.getAppPath(), 'src', 'main', 'models')

        this.worker.postMessage({
          type: 'init',
          payload: {
            modelName: this.modelName,
            modelCacheDir,
            localModelsRoot
          }
        })
      } catch (err) {
        reject(err)
      }
    })

    return this.initPromise
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
    await this.ensureWorker()
    if (!this.worker) throw new Error('Worker not available')

    this.updateActiveState(1)
    const jobId = ++this.workerJobCounter
    return new Promise((resolve, reject) => {
      this.pendingJobs.set(jobId, { 
        resolve: (v) => {
          this.updateActiveState(-1)
          resolve(v)
        }, 
        reject: (e) => {
          this.updateActiveState(-1)
          reject(e)
        } 
      })
      this.worker!.postMessage({
        type: 'embed',
        id: jobId,
        payload: { text }
      })
    })
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

        await (prisma as any).messageVector.upsert({
          where: { messageId },
          create: { messageId, vector: vectorJson },
          update: { vector: vectorJson }
        })

        await prisma.$executeRawUnsafe(`DELETE FROM vec_messages WHERE messageId = ?`, messageId)
        await prisma.$executeRawUnsafe(
          `INSERT INTO vec_messages(messageId, vector) VALUES (?, ?)`,
          messageId,
          vectorJson
        )
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
    
    await this.ensureWorker()

    const indexed = await (prisma as any).messageVector.findMany({ select: { messageId: true } })
    const indexedSet = new Set<string>(indexed.map((v: any) => v.messageId))

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
    this.updateActiveState(1)

    try {
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

          await prisma.$executeRawUnsafe(`DELETE FROM vec_messages WHERE messageId = ?`, m.id)
          await prisma.$executeRawUnsafe(
            `INSERT INTO vec_messages(messageId, vector) VALUES (?, ?)`,
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
      }
    } finally {
      this.updateActiveState(-1)
      console.log(`[EmbeddingService] Bulk indexing complete.`)
    }
  }

  async clearAllVectors(): Promise<void> {
    await (prisma as any).messageVector.deleteMany({})
    await prisma.$executeRawUnsafe(`DELETE FROM vec_messages`)
    console.log('[EmbeddingService] All vectors cleared.')
  }
}

export const embeddingService = new EmbeddingService()
