import { BrowserWindow } from 'electron'
import { IDataWipeService } from '../IDataWipeService'
import type { IWAEventBus, WAEventBusFactory } from './IWAEventBus'
import { createSubscribers, SubscriberServices } from './subscribers'
import { IAuthSettingsService } from '../auth/IAuthSettingsService'
import { IChatRepository } from '../chats/IChatRepository'
import type { IEmbeddingOperationalControl } from '../search/IEmbeddingService'
import { WAWorkerBridge } from '../../workers/bridge/WAWorkerBridge'

export interface WhatsAppConnectionDependencies extends SubscriberServices {
  embeddingService: IEmbeddingOperationalControl
}

export class WhatsAppConnectionManager {
  private currentSock: WAWorkerBridge | null = null
  private mainWindow: BrowserWindow | null = null
  private currentBus: IWAEventBus | null = null
  private isFreshLogin = false
  private busCreatedCallback: ((bus: IWAEventBus) => void) | null = null

  // Bounded supervised-reconnect state (see setUnexpectedExitHandler wiring).
  private static readonly MAX_WORKER_RESTARTS = 5
  private workerRestartAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private isAutoReconnecting = false

  constructor(
    private deps: WhatsAppConnectionDependencies,
    private readonly authSettingsService: IAuthSettingsService,
    private readonly chatRepository: IChatRepository,
    private readonly dataWipeService: IDataWipeService,
    private readonly eventBusFactory: WAEventBusFactory,
    private readonly waWorkerBridge: WAWorkerBridge
  ) {
    // Supervise the worker thread: an unexpected (non-zero, not via stop())
    // exit otherwise leaves WhatsApp permanently dead until an app restart.
    this.waWorkerBridge.setUnexpectedExitHandler((code) => this.handleWorkerDeath(code))
  }

  private handleWorkerDeath(code: number): void {
    if (this.reconnectTimer) return
    if (this.workerRestartAttempts >= WhatsAppConnectionManager.MAX_WORKER_RESTARTS) {
      console.error(
        `[WhatsAppConnectionManager] WhatsApp worker died (code ${code}) and the max ` +
        `${WhatsAppConnectionManager.MAX_WORKER_RESTARTS} restart attempts are exhausted — giving up until a manual reconnect.`
      )
      return
    }
    this.workerRestartAttempts++
    const delayMs = Math.min(2000 * 2 ** (this.workerRestartAttempts - 1), 30_000)
    console.warn(
      `[WhatsAppConnectionManager] WhatsApp worker died (code ${code}); ` +
      `reconnect attempt ${this.workerRestartAttempts}/${WhatsAppConnectionManager.MAX_WORKER_RESTARTS} in ${delayMs}ms`
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.isAutoReconnecting = true
      this.connect()
        .catch((err) => console.error('[WhatsAppConnectionManager] Supervised reconnect failed:', err))
        .finally(() => { this.isAutoReconnecting = false })
    }, delayMs)
  }

  public setWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  public getSocket(): WAWorkerBridge | null {
    return this.currentSock
  }

  public getBus(): IWAEventBus | null {
    return this.currentBus
  }

  public onBusCreated(callback: (bus: IWAEventBus) => void): void {
    this.busCreatedCallback = callback
  }

  public async connect(): Promise<void> {
    // A manual/external connect (settings toggle, re-login, cold start) clears
    // the supervised-reconnect backoff; an auto-reconnect keeps counting so the
    // attempt cap holds.
    if (!this.isAutoReconnecting) {
      this.workerRestartAttempts = 0
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
    }

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

    // Clean up orphan data if not logged in.
    // `hasCreds()` can throw on a transient DB failure (lock contention with the
    // worker, I/O). We must fail CLOSED here: an errored read is NOT proof the
    // user is logged out, and the branch below wipes the entire local database.
    // On error, assume creds exist and skip the wipe — a genuinely logged-out
    // user still gets the QR flow once the read succeeds.
    let existingCreds = true
    try {
      existingCreds = await this.authSettingsService.hasCreds()
    } catch (err) {
      console.error('[WhatsAppConnectionManager] hasCreds() failed — assuming creds exist, skipping wipe:', err)
    }
    if (!existingCreds) {
      this.isFreshLogin = true
      await this.authSettingsService.clearHistorySyncCompleted().catch((err) => {
        console.error('[WhatsAppConnectionManager] failed to delete history_sync_completed flag:', err)
      })

      const orphanChats = await this.chatRepository.countChats()
      if (orphanChats > 0) {
        console.log(`[Cleanup] No auth creds but found ${orphanChats} orphan chats — wiping stale data`)
        try {
          await this.dataWipeService.wipeAllData()
        } catch (err) {
          // wipeAllData now throws on a partial wipe. Abort the connect rather
          // than starting the worker against a half-emptied database.
          console.error('[Cleanup] wipeAllData failed — aborting connect to avoid a partial-wipe state:', err)
          return
        }
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
    // Notify any listeners that a fresh bus is available (e.g. to replay plugin subscriptions)
    this.busCreatedCallback?.(bus)

    this.currentSock = this.waWorkerBridge

    // Start the worker bridge!
    this.waWorkerBridge.start(syncFullHistory, shouldSyncHistory)
  }

  /**
   * Graceful shutdown for app quit: cancel any pending supervised reconnect and
   * terminate the worker bridge so it isn't killed abruptly by `app.exit(0)`
   * mid-transaction.
   */
  public async shutdown(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.workerRestartAttempts = WhatsAppConnectionManager.MAX_WORKER_RESTARTS
    try {
      await this.waWorkerBridge.stop()
    } catch (err) {
      console.warn('[WhatsAppConnectionManager] Error stopping worker bridge during shutdown:', err)
    }
    this.currentSock = null
    if (this.currentBus) {
      this.currentBus.removeAllListeners()
      this.currentBus = null
    }
  }

  public skipSync(): void {
    if (this.currentSock) {
      this.currentSock.skipSync().catch((err) => {
        console.error('[WhatsAppConnectionManager] Failed to send skipSync command:', err)
      })
    }
  }
}
