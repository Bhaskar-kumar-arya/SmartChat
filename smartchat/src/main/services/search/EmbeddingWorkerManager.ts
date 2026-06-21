import { Worker } from 'worker_threads'
import { IEmbeddingConfig, IEmbeddingWorkerManager } from './IEmbeddingWorkerManager'

export class EmbeddingWorkerManager implements IEmbeddingWorkerManager {
  private worker: Worker | null = null
  private workerJobCounter = 0
  private pendingJobs = new Map<number, { resolve: (v: number[]) => void; reject: (e: Error) => void }>()
  private initPromise: Promise<void> | null = null
  private onActiveStateChange?: (isActive: boolean) => void
  private activeJobs = 0

  constructor(private readonly config: IEmbeddingConfig) {}

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

  public setModel(modelName: string): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'setModel', payload: { modelName } })
    }
  }

  public async ensureWorker(modelName: string): Promise<void> {
    if (this.worker) return
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      try {
        console.log(`[EmbeddingWorkerManager] Starting worker from: ${this.config.workerPath}`)
        const currentWorker = new Worker(this.config.workerPath)
        this.worker = currentWorker

        interface WorkerMessage {
          type: 'init_done' | 'progress' | 'embed_done' | 'error' | string
          id: number | null
          payload: {
            status?: string
            file?: string
            loaded?: number
            total?: number
            vector?: number[]
            error?: string
          }
        }

        currentWorker.on('message', (msg: WorkerMessage) => {
          if (msg.type === 'init_done') {
            console.log('[EmbeddingWorkerManager] Worker initialized.')
            resolve()
          } else if (msg.type === 'progress') {
            const p = msg.payload
            if (p.status === 'progress' && p.file && p.loaded !== undefined && p.total !== undefined) {
              console.log(`[EmbeddingWorkerManager] Worker Download: ${p.file} (${Math.round((p.loaded / p.total) * 100)}%)`)
            }
          } else if (msg.type === 'embed_done') {
            if (msg.id !== null && msg.id !== undefined) {
              const job = this.pendingJobs.get(msg.id)
              if (job && msg.payload.vector) {
                job.resolve(msg.payload.vector)
                this.pendingJobs.delete(msg.id)
              }
            }
          } else if (msg.type === 'error') {
            if (msg.id !== null && msg.id !== undefined) {
              const job = this.pendingJobs.get(msg.id)
              if (job) {
                job.reject(new Error(msg.payload.error || 'Unknown worker error'))
                this.pendingJobs.delete(msg.id)
              }
            } else {
              console.error('[EmbeddingWorkerManager] Worker Global Error:', msg.payload.error)
              reject(new Error(msg.payload.error || 'Unknown worker error'))
            }
          }
        })

        currentWorker.on('error', (err) => {
          console.error('[EmbeddingWorkerManager] Worker Critical Error:', err)
          reject(err)
        })

        currentWorker.on('exit', (code) => {
          if (code !== 0) console.error(`[EmbeddingWorkerManager] Worker stopped with exit code ${code}`)
          this.worker = null
          this.initPromise = null
        })

        currentWorker.postMessage({
          type: 'init',
          payload: {
            modelName,
            modelCacheDir: this.config.modelCacheDir,
            localModelsRoot: this.config.localModelsRoot
          }
        })
      } catch (err) {
        reject(err as Error)
      }
    })

    return this.initPromise
  }

  async embed(text: string): Promise<number[]> {
    const currentWorker = this.worker
    if (!currentWorker) throw new Error('Worker not available')

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
      currentWorker.postMessage({
        type: 'embed',
        id: jobId,
        payload: { text }
      })
    })
  }
}
