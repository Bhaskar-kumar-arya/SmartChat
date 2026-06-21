export interface IEmbeddingComputer {
  embed(text: string): Promise<number[]>
}

export interface IMessageIndexer {
  indexMessage(messageId: string, text: string): Promise<void>
  indexAll(onProgress?: (pct: number) => void): Promise<void>
  clearAllVectors(): Promise<void>
}

export interface IEmbeddingModelConfig {
  setModel(modelName: string): void
  getModel(): string
}

export interface IEmbeddingOperationalControl {
  setPaused(paused: boolean): void
  setOnActiveStateSync(cb: (isActive: boolean) => void): void
}

export interface IEmbeddingService extends IEmbeddingComputer, IMessageIndexer, IEmbeddingModelConfig, IEmbeddingOperationalControl {}
