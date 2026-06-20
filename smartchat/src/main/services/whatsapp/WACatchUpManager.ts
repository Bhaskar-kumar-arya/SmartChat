import { BrowserWindow } from 'electron'
import { ConnectionState } from '@whiskeysockets/baileys'
import { IWACatchUpManager } from './IWACatchUpManager'
import { IEmbeddingService } from '../search/EmbeddingService'
import { IAuthSettingsService } from '../auth/IAuthSettingsService'

export class WACatchUpManager implements IWACatchUpManager {
  private isWaitingForCatchUp = false
  private catchUpTimeout: NodeJS.Timeout | null = null
  private hasReceivedPendingNotifications = false
  private mainWindow: BrowserWindow | null = null

  constructor(
    private readonly embeddingService: IEmbeddingService,
    private readonly authSettingsService: IAuthSettingsService
  ) {}

  public setWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  public hasReceivedPending(): boolean {
    return this.hasReceivedPendingNotifications
  }

  public isWaiting(): boolean {
    return this.isWaitingForCatchUp
  }

  public start(syncFullHistory: boolean): void {
    console.log('[Connection] Reconnect: history sync previously completed. Waiting for offline catch-up...')
    this.isWaitingForCatchUp = true
    this.embeddingService.setPaused(true)

    if (this.catchUpTimeout) {
      clearTimeout(this.catchUpTimeout)
    }

    this.catchUpTimeout = setTimeout(() => {
      console.warn('[Connection] Catch-up safety timeout reached. Forcing transition.')
      this.completeCatchUp(syncFullHistory)
    }, 30000)

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('wa-sync-status', 'Syncing missed messages...')
    }
  }

  public async handleUpdate(update: Partial<ConnectionState>): Promise<void> {
    const { receivedPendingNotifications } = update
    if (receivedPendingNotifications !== undefined) {
      this.hasReceivedPendingNotifications = receivedPendingNotifications
    }

    if (receivedPendingNotifications === true && this.isWaitingForCatchUp) {
      console.log('[Connection] Received pending notifications (catch-up complete).')
      const syncFullHistory = await this.authSettingsService.getSyncFullHistory()
      this.completeCatchUp(syncFullHistory)
    }
  }

  public reset(): void {
    if (this.catchUpTimeout) {
      clearTimeout(this.catchUpTimeout)
      this.catchUpTimeout = null
    }
    this.isWaitingForCatchUp = false
    this.hasReceivedPendingNotifications = false
  }

  private completeCatchUp(syncFullHistory: boolean): void {
    if (!this.isWaitingForCatchUp) {
      return
    }
    this.isWaitingForCatchUp = false

    if (this.catchUpTimeout) {
      clearTimeout(this.catchUpTimeout)
      this.catchUpTimeout = null
    }

    console.log('[Connection] Catch-up finished. Unpausing embedding and completing sync.')
    this.embeddingService.setPaused(false)

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('wa-sync-progress', {
        progress: 100,
        syncType: 6, // SYNC_TYPE_GROUP_HYDRATION
        syncFullHistory
      })
      this.mainWindow.webContents.send('wa-sync-complete')
    }
  }
}
