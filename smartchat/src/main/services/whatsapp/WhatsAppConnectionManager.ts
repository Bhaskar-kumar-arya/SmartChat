import { BrowserWindow } from 'electron'
import makeWASocketImport, { DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys'

const makeWASocket = (typeof makeWASocketImport === 'function'
  ? makeWASocketImport
  : (makeWASocketImport as any).default) as typeof makeWASocketImport
import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import { usePrismaAuthState } from '../../auth'
import { WASocket } from './types'
import {
  RECONNECT_DELAY_RESTART_MS,
  RECONNECT_DELAY_DEFAULT_MS
} from '../../constants'
import { IDataWipeService } from '../IDataWipeService'
import { WAEventHandler } from './WAEventHandler'
import type { IWAEventBus, WAEventBusFactory } from './IWAEventBus'
import { createSubscribers, SubscriberServices } from './subscribers'
import { IHistorySyncManager } from './IHistorySyncManager'
import { BaileysPatcher } from './BaileysPatcher'
import { IWAEventWiringService, ConnectionCallbacks } from './IWAEventWiringService'
import { IAuthSettingsService } from '../auth/IAuthSettingsService'
import { IChatRepository } from '../chats/IChatRepository'
import { IMessageQueryRepository } from '../messages/IMessageQueryRepository'
import type { IEmbeddingService } from '../search/EmbeddingService'

export interface WhatsAppConnectionDependencies extends SubscriberServices {
  embeddingService: IEmbeddingService
}

export class WhatsAppConnectionManager implements ConnectionCallbacks {
  private currentSock: WASocket | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private isFreshLogin = false
  private mainWindow: BrowserWindow | null = null
  private currentBus: IWAEventBus | null = null

  constructor(
    private deps: WhatsAppConnectionDependencies,
    private readonly authSettingsService: IAuthSettingsService,
    private readonly chatRepository: IChatRepository,
    private readonly messageQueryRepository: IMessageQueryRepository,
    private readonly dataWipeService: IDataWipeService,
    private historySyncManager: IHistorySyncManager,
    private wiringService: IWAEventWiringService,
    private readonly eventBusFactory: WAEventBusFactory
  ) {}

  public setWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  public getSocket(): WASocket | null {
    return this.currentSock
  }

  public getBus(): IWAEventBus | null {
    return this.currentBus
  }

  public async connect(): Promise<void> {
    BaileysPatcher.patch()
    this.deps.embeddingService.setPaused(false) // Clean start
    if (!this.mainWindow) {
      console.warn('[WhatsAppConnectionManager] No window set, cannot connect.')
      return
    }

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Gracefully shut down existing socket
    if (this.currentSock) {
      console.log('[Connection] Cleaning up previous socket instance before reconnecting...')
      try {
        const ev = this.currentSock.ev as unknown as { removeAllListeners?: () => void }
        ev.removeAllListeners?.()
        this.currentSock.end(new Error('Replaced by new socket instance'))
      } catch (err) {
        console.warn('[Connection] Error cleaning up old socket:', err)
      }
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

    const { state, saveCreds } = await usePrismaAuthState()
    let version: [number, number, number] = [2, 3000, 1035194821]
    let isLatest = false
    try {
      console.log('[Connection] Fetching latest WhatsApp version from Baileys...')
      const latest = await fetchLatestBaileysVersion()
      version = latest.version as [number, number, number]
      isLatest = latest.isLatest
      console.log(`[Connection] Successfully fetched WA v${version.join('.')}, isLatest: ${isLatest}`)
    } catch (err) {
      console.warn('[Connection] Failed to fetch latest WhatsApp version (possibly offline). Using fallback version.', err)
    }

    if (this.isFreshLogin) {
      await this.authSettingsService.clearHistorySyncCompleted().catch((err) => {
        console.error('[WhatsAppConnectionManager] fresh login authState deletion failed:', err)
      })
    }

    const isHistorySyncCompleted = await this.authSettingsService.getHistorySyncCompleted()

    // Clear HistorySyncManager for this connection
    this.historySyncManager.clear()

    const isInitialSyncInProgress = this.historySyncManager.isInProgress
    const shouldSyncHistory = this.isFreshLogin || isInitialSyncInProgress || !isHistorySyncCompleted

    const syncFullHistory = await this.authSettingsService.getSyncFullHistory()

    const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory,
      shouldSyncHistoryMessage: () => shouldSyncHistory,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
      getMessage: async (key) => {
        if (!key.id) return undefined
        try {
          const msg = await this.messageQueryRepository.findMessageById(key.id)
          if (msg && msg.content) {
            return JSON.parse(msg.content)
          }
        } catch (err) {
          console.error('Error fetching message for retry/reaction:', err)
        }
        return undefined
      }
    })

    this.currentSock = sock

    // Create the event bus and wire up all subscribers for this connection
    const bus = this.eventBusFactory()
    this.currentBus = bus
    createSubscribers(bus, this.deps, () => this.mainWindow)

    const eventHandler = new WAEventHandler(this.deps.messageProcessingService, this.deps.messageParserService, bus)

    // Delegate all event wiring to WAEventWiringService
    this.wiringService.wire(
      sock,
      eventHandler,
      this,
      saveCreds,
      syncFullHistory
    )
  }

  public handleQr(qr: string): void {
    console.log('Got QR string:', qr)
    this.isFreshLogin = true
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('wa-qr', qr)
    }
  }

  public async handleConnectionClose(lastDisconnect: any): Promise<void> {
    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
    const errorData = (lastDisconnect?.error as unknown as { data?: { tag?: string } })?.data
    const isConflict = statusCode === 440 || statusCode === 409 || errorData?.tag === 'conflict'
    const isRestartRequired = statusCode === DisconnectReason.restartRequired
    const shouldReconnect = (statusCode !== DisconnectReason.loggedOut && !isConflict) || isRestartRequired

    console.log(`[Connection] Closed | statusCode=${statusCode} | isRestart=${isRestartRequired} | isConflict=${isConflict} | shouldReconnect=${shouldReconnect} | error=`, lastDisconnect?.error)

    if (shouldReconnect) {
      const delay = isRestartRequired ? RECONNECT_DELAY_RESTART_MS : RECONNECT_DELAY_DEFAULT_MS
      console.log(`[Connection] Scheduling reconnect in ${delay}ms...`)
      this.reconnectTimeout = setTimeout(() => this.connect(), delay)
    } else if (isConflict) {
      console.warn('[Connection] Replaced by another session (440 conflict). Standing down.')
    } else {
      console.log('Logged out — wiping all data for fresh QR...')
      try {
        await this.dataWipeService.wipeAllData()
      } catch (err) {
        console.error('Error wiping data:', err)
      }
      this.isFreshLogin = true
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('wa-logged-out')
      }
      this.connect()
    }
  }

  public async handleConnectionOpen(sock: WASocket, syncFullHistory: boolean): Promise<void> {
    console.log('Connected to WhatsApp!')
    if (sock.user) {
      await this.deps.contactService.registerMe(sock.user).catch((err) => {
        console.error('[Connection] Failed to register logged-in user identity:', err)
      })
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const isInitialSyncInProgress = this.historySyncManager.isInProgress 
      if (!this.isFreshLogin && !isInitialSyncInProgress) {
        const isHistorySyncCompleted = await this.authSettingsService.getHistorySyncCompleted()

        if (isHistorySyncCompleted) {
          console.log(`[Connection] Reconnect: history sync previously completed, skipping sync`)
          this.deps.embeddingService.setPaused(false)
          this.mainWindow.webContents.send('wa-sync-progress', {
            progress: 100,
            syncType: 6, // SYNC_TYPE_GROUP_HYDRATION
            syncFullHistory
          })
          this.mainWindow.webContents.send('wa-sync-complete')
        } else {
          console.log(`[Connection] Reconnect: history sync NOT completed, continuing sync`)
          this.mainWindow.webContents.send('wa-connected')
        }
      } else {
        console.log('[Connection] Fresh login or active sync reconnect detected, showing/continuing sync screen')
        this.historySyncManager.setInProgress(true)
        this.isFreshLogin = false
        this.mainWindow.webContents.send('wa-connected')
      }
    }
  }

  public skipSync(): void {
    if (this.currentSock) {
      this.historySyncManager.skipSync(this.currentSock)
    }
  }
}

