import { BrowserWindow } from 'electron'
import { IDataWipeService } from '../IDataWipeService'
import type { IWAEventBus, WAEventBusFactory } from './IWAEventBus'
import { createSubscribers, SubscriberServices } from './subscribers'
import { IAuthSettingsService } from '../auth/IAuthSettingsService'
import { IChatRepository } from '../chats/IChatRepository'
import type { IEmbeddingOperationalControl } from '../search/IEmbeddingService'
import { WAWorkerBridge } from '../../workers/WAWorkerBridge'

export interface WhatsAppConnectionDependencies extends SubscriberServices {
  embeddingService: IEmbeddingOperationalControl
}

export class WhatsAppConnectionManager {
  private currentSock: WAWorkerBridge | null = null
  private mainWindow: BrowserWindow | null = null
  private currentBus: IWAEventBus | null = null
  private isFreshLogin = false

  constructor(
    private deps: WhatsAppConnectionDependencies,
    private readonly authSettingsService: IAuthSettingsService,
    private readonly chatRepository: IChatRepository,
    private readonly dataWipeService: IDataWipeService,
    private readonly eventBusFactory: WAEventBusFactory,
    private readonly waWorkerBridge: WAWorkerBridge
  ) { }

  public setWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  public getSocket(): WAWorkerBridge | null {
    return this.currentSock
  }

  public getBus(): IWAEventBus | null {
    return this.currentBus
  }

  public async connect(): Promise<void> {
    this.deps.embeddingService.setPaused(false) // Clean start
    if (!this.mainWindow) {
      console.warn('[WhatsAppConnectionManager] No window set, cannot connect.')
      return
    }

    // Gracefully shut down existing bridge connection
    if (this.currentSock) {
      console.log('[Connection] Stopping previous worker bridge instance before reconnecting...')
      await this.currentSock.stop().catch((err) => {
        console.warn('[Connection] Error stopping old bridge:', err)
      })
      this.currentSock = null
    }

    // Tear down previous event bus and subscribers
    if (this.currentBus) {
      this.currentBus.removeAllListeners()
      this.currentBus = null
    }

    // Clean up orphan data if not logged in
    const existingCreds = await this.authSettingsService.hasCreds()
    if (!existingCreds) {
      this.isFreshLogin = true
      await this.authSettingsService.clearHistorySyncCompleted().catch((err) => {
        console.error('[WhatsAppConnectionManager] failed to delete history_sync_completed flag:', err)
      })

      const orphanChats = await this.chatRepository.countChats()
      if (orphanChats > 0) {
        console.log(`[Cleanup] No auth creds but found ${orphanChats} orphan chats — wiping stale data`)
        await this.dataWipeService.wipeAllData()
      }
    }

    if (this.isFreshLogin) {
      await this.authSettingsService.clearHistorySyncCompleted().catch((err) => {
        console.error('[WhatsAppConnectionManager] fresh login authState deletion failed:', err)
      })
    }

    const isHistorySyncCompleted = await this.authSettingsService.getHistorySyncCompleted()
    const shouldSyncHistory = this.isFreshLogin || !isHistorySyncCompleted
    const syncFullHistory = await this.authSettingsService.getSyncFullHistory()

    // Create the event bus and wire up all subscribers for this connection
    const bus = this.eventBusFactory()
    this.currentBus = bus
    createSubscribers(bus, this.deps, () => this.mainWindow)

    this.currentSock = this.waWorkerBridge

    // Start the worker bridge!
    this.waWorkerBridge.start(syncFullHistory, shouldSyncHistory)
  }

  public skipSync(): void {
    if (this.currentSock) {
      this.currentSock.skipSync().catch((err) => {
        console.error('[WhatsAppConnectionManager] Failed to send skipSync command:', err)
      })
    }
  }
}
