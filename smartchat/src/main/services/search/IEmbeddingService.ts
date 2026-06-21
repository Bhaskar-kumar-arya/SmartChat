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
