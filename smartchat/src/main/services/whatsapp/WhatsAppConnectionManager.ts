import { BrowserWindow } from 'electron'
import makeWASocketImport, { DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys'

const makeWASocket = (typeof makeWASocketImport === 'function'
  ? makeWASocketImport
  : (makeWASocketImport as any).default) as typeof makeWASocketImport
import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import { usePrismaAuthState } from '../../auth'
import { PrismaClient } from '@prisma/client'
import { WASocket } from '../../types'
import {
  RECONNECT_DELAY_RESTART_MS,
  RECONNECT_DELAY_DEFAULT_MS
} from '../../constants'
import { DataWipeService } from '../DataWipeService'
import type { ServiceContainer } from '../../ServiceContainer'
import { WAEventHandler } from './WAEventHandler'
import { WAEventBus } from './WAEventBus'
import { createSubscribers } from './subscribers'
import { HistorySyncManager } from './HistorySyncManager'
import { BaileysPatcher } from './BaileysPatcher'
// import { waEventLogger } from './WAEventLogger'

export class WhatsAppConnectionManager {
  private currentSock: WASocket | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private isFreshLogin = false
  private mainWindow: BrowserWindow | null = null
  private historySyncManager: HistorySyncManager
  private currentBus: WAEventBus | null = null

  constructor(
    private services: ServiceContainer,
    private prisma: PrismaClient
  ) {
    this.historySyncManager = new HistorySyncManager(this.services, () => this.mainWindow, this.prisma)
  }

  public setWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  public getSocket(): WASocket | null {
    return this.currentSock
  }

  public getBus(): WAEventBus | null {
    return this.currentBus
  }

  public async connect() {
    BaileysPatcher.patch()
    this.services.embeddingService.setPaused(false) // Clean start
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
    const existingCreds = await this.prisma.authState.findUnique({ where: { id: 'creds' } })
    if (!existingCreds) {
      this.isFreshLogin = true
      await this.prisma.authState.deleteMany({
        where: { id: 'history_sync_completed' }
      }).catch((err) => {
        console.error('[WhatsAppConnectionManager] failed to delete history_sync_completed flag:', err)
      })

      const orphanChats = await this.prisma.chat.count()
      if (orphanChats > 0) {
        console.log(`[Cleanup] No auth creds but found ${orphanChats} orphan chats — wiping stale data`)
        const dataWipeService = new DataWipeService(this.prisma)
        await dataWipeService.wipeAllData()
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
      await this.prisma.authState.deleteMany({
        where: { id: 'history_sync_completed' }
      }).catch((err) => {
        console.error('[WhatsAppConnectionManager] fresh login authState deletion failed:', err)
      })
    }

    const syncCompletedRow = await this.prisma.authState.findUnique({
      where: { id: 'history_sync_completed' }
    }).catch((err) => {
      console.error('[WhatsAppConnectionManager] find history_sync_completed failed:', err)
      return null
    })
    const isHistorySyncCompleted = syncCompletedRow?.data === 'true'

    // Clear HistorySyncManager for this connection
    this.historySyncManager.clear()

    const isInitialSyncInProgress = this.historySyncManager.isInProgress
    const shouldSyncHistory = this.isFreshLogin || isInitialSyncInProgress || !isHistorySyncCompleted

    const fullHistoryRow = await this.prisma.authState.findUnique({
      where: { id: 'sync_full_history' }
    }).catch((err) => {
      console.error('[WhatsAppConnectionManager] find sync_full_history failed:', err)
      return null
    })
    const syncFullHistory = fullHistoryRow?.data === 'true'

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
        if (!key.id) return undefined;
        try {
          const msg = await this.prisma.message.findUnique({ where: { id: key.id } });
          if (msg && msg.content) {
            return JSON.parse(msg.content);
          }
        } catch (err) {
          console.error('Error fetching message for retry/reaction:', err);
        }
        return undefined;
      }
    })

    this.currentSock = sock

    // Prevent MaxListenersExceededWarning
    try {
      const evTarget = sock.ev as unknown as {
        target?: { setMaxListeners?: (n: number) => void }
        setMaxListeners?: (n: number) => void
      }
      if (evTarget.target?.setMaxListeners) {
        evTarget.target.setMaxListeners(100)
      } else if (evTarget.setMaxListeners) {
        evTarget.setMaxListeners(100)
      }
    } catch (err) {
      console.warn('[Connection] Failed to set max listeners:', err)
    }

    // creds.update must stay as a direct listener (saveCreds is a plain callback)
    sock.ev.on('creds.update', saveCreds)

    // Create the event bus and wire up all subscribers for this connection
    const bus = new WAEventBus()
    this.currentBus = bus
    createSubscribers(bus, this.services, () => this.mainWindow, this.prisma)

    const eventHandler = new WAEventHandler(this.services, bus)

    // All other events go through ev.process()
    sock.ev.process(async (events) => {
      // ── Connection ────────────────────────────────────────────────────────
      if (events['connection.update']) {
        const update = events['connection.update']
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          console.log('Got QR string:', qr)
          this.isFreshLogin = true
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('wa-qr', qr)
          }
        }

        if (connection === 'close') {
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
              const dataWipeService = new DataWipeService(this.prisma)
              await dataWipeService.wipeAllData()
            } catch (err) {
              console.error('Error wiping data:', err)
            }
            this.isFreshLogin = true
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('wa-logged-out')
            }
            this.connect()
          }
        } else if (connection === 'open') {
          console.log('Connected to WhatsApp!')
          if (sock.user) {
            await this.services.contactService.registerMe(sock.user).catch((err) => {
              console.error('[Connection] Failed to register logged-in user identity:', err)
            })
          }

          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (!this.isFreshLogin && !isInitialSyncInProgress) {
              const syncCompletedRow = await this.prisma.authState.findUnique({
                where: { id: 'history_sync_completed' }
              }).catch((err) => {
                console.error('[WhatsAppConnectionManager] find history_sync_completed on reconnect failed:', err)
                return null
              })
              const isHistorySyncCompleted = syncCompletedRow?.data === 'true'

              if (isHistorySyncCompleted) {
                console.log(`[Connection] Reconnect: history sync previously completed, skipping sync`)
                this.services.embeddingService.setPaused(false)
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
      }

      // ── History Sync ──────────────────────────────────────────────────────
      if (events['messaging-history.set']) {
        const data = events['messaging-history.set']
        await this.historySyncManager.handleSyncChunk(data, syncFullHistory, sock)
      }

      // ── Messages Upsert ───────────────────────────────────────────────────
      if (events['messages.upsert']) {
        await eventHandler.handleMessagesUpsert(events['messages.upsert'], sock)
      }

      // ── Message Updates (revoke/edit/status via messages.update) ──────────
      if (events['messages.update']) {
        await eventHandler.handleMessagesUpdate(events['messages.update'], sock)
      }

      // ── Contacts ──────────────────────────────────────────────────────────
      if (events['contacts.upsert']) {
        await eventHandler.handleContactsUpsert(events['contacts.upsert'])
      }

      if (events['contacts.update']) {
        await eventHandler.handleContactsUpdate(events['contacts.update'])
      }

      if (events['lid-mapping.update']) {
        await eventHandler.handleLidMappingUpdate(events['lid-mapping.update'])
      }

      // ── Chats ─────────────────────────────────────────────────────────────
      if (events['chats.update']) {
        await eventHandler.handleChatsUpdate(events['chats.update'])
      }

      if (events['chats.upsert']) {
        await eventHandler.handleChatsUpsert(events['chats.upsert'])
      }

      // ── Groups ────────────────────────────────────────────────────────────
      if (events['groups.update']) {
        await eventHandler.handleGroupsUpdate(events['groups.update'])
      }

      if (events['group-participants.update']) {
        await eventHandler.handleGroupParticipantsUpdate(events['group-participants.update'])
      }

      // ── Message Reactions (messages.reaction) ─────────────────────────────
      if (events['messages.reaction']) {
        await eventHandler.handleMessagesReaction(events['messages.reaction'], sock)
      }

      // ── Presence ──────────────────────────────────────────────────────────
      if (events['presence.update']) {
        await eventHandler.handlePresenceUpdate(events['presence.update'], sock)
      }

      // ── Message Receipts (read/delivered ticks) ───────────────────────────
      if (events['message-receipt.update']) {
        await eventHandler.handleMessageReceiptUpdate(events['message-receipt.update'], sock)
      }

      // ── Call Events ───────────────────────────────────────────────────────
      if (events['call']) {
        await eventHandler.handleCallEvent(events['call'])
      }

      // ── App State Sync ────────────────────────────────────────────────────
      if (events['app-state.sync']) {
        const syncEvent = events['app-state.sync']
        const syncEvents = Array.isArray(syncEvent) ? (syncEvent as unknown[]) : [syncEvent]
        // for (const e of syncEvents) {
        //   waEventLogger.log('app-state.sync', e)
        // }
        await eventHandler.handleAppStateSync(syncEvents, sock)
      }
    })
  }

  public skipSync() {
    if (this.currentSock) {
      this.historySyncManager.skipSync(this.currentSock)
    }
  }
}
