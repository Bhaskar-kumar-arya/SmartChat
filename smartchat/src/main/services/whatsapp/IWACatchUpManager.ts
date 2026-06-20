import { BrowserWindow } from 'electron'
import { ConnectionState } from '@whiskeysockets/baileys'

export interface IWACatchUpManager {
  setWindow(window: BrowserWindow | null): void
  hasReceivedPending(): boolean
  isWaiting(): boolean
  start(syncFullHistory: boolean): void
  handleUpdate(update: Partial<ConnectionState>): Promise<void>
  reset(): void
}
