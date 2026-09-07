export interface IEmbeddingConfig {
  workerPath: string
  modelCacheDir: string
  localModelsRoot: string
}

export interface IEmbeddingWorkerManager {
  ensureWorker(modelName: string): Promise<void>
  embed(text: string): Promise<number[]>
  setModel(modelName: string): void
  setOnActiveStateSync(cb: (isActive: boolean) => void): void
  /**
   * Gracefully terminate the worker thread: reject any in-flight jobs and drop
   * all state so it can be re-spawned by the next `ensureWorker`. Called from
   * the app shutdown sequence so the worker isn't killed mid-write to the
   * sqlite-vec virtual table by `app.exit(0)`.
   */
  terminate(): Promise<void>
}
