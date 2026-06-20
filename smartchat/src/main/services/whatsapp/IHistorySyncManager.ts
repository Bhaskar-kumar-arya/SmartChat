import { WASocket } from './types'

export interface IHistorySyncManager {
  get isComplete(): boolean
  get isInProgress(): boolean
  setInProgress(val: boolean): void
  clear(): void
  handleSyncChunk(data: unknown, syncFullHistory: boolean, sock: WASocket): Promise<void>
  finishSync(sock: WASocket, syncFullHistory: boolean): Promise<void>
  skipSync(sock: WASocket): Promise<void>
}
