export interface IExtensionSchedulerService {
  setInterval(extensionId: string, ms: number, fn: () => void | Promise<void>): () => void
  setTimeout(extensionId: string, ms: number, fn: () => void | Promise<void>): () => void
  registerCron(extensionId: string, name: string, expr: string, fn: () => void | Promise<void>): void
  cancelAll(extensionId: string): void
}
