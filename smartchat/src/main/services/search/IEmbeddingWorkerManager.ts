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
}
