import { PrismaClient } from '@prisma/client'
import type { WASocket } from '@whiskeysockets/baileys'
import { fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import NodeCache from 'node-cache'
import * as fs from 'fs'
import { join } from 'path'
import { IWorkerBootstrap } from '../IWorkerBootstrap'
import { IWorkerEventPublisher } from '../events/IWorkerEventPublisher'
import { useLocalPrismaAuthState } from './useLocalPrismaAuthState'
import { connectSocket } from './connectSocket'
import { WorkerConnectionHandler } from './workerConnectionHandler'
import { WorkerEventDispatcher } from '../events/workerEventDispatcher'

/**
 * WorkerConnectionManager
 * =======================
 * Handles the state and scheduling logic around opening a socket, handling reconnections,
 * wiping local database tables on logout, and coordinating the handlers.
 */
export class WorkerConnectionManager {
  private sock: WASocket | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private isFreshLogin = false

  private prisma: PrismaClient | null = null
  private repos: IWorkerBootstrap | null = null
  private userDataPath = ''
  private syncFullHistory = false

  private connectionHandler: WorkerConnectionHandler | null = null
  private eventDispatcher: WorkerEventDispatcher | null = null

  constructor(private readonly eventPublisher: IWorkerEventPublisher) {}

  public getSocket(): WASocket | null {
    return this.sock
  }

  public getRepos(): IWorkerBootstrap | null {
    return this.repos
  }

  public getSyncFullHistory(): boolean {
    return this.syncFullHistory
  }

  public getIsFreshLogin(): boolean {
    return this.isFreshLogin
  }

  public setIsFreshLogin(val: boolean) {
    this.isFreshLogin = val
  }

  public setup(
    userDataPath: string,
    syncFullHistory: boolean,
    prisma: PrismaClient,
    repos: IWorkerBootstrap
  ) {
    this.userDataPath = userDataPath
    this.syncFullHistory = syncFullHistory
    this.prisma = prisma
    this.repos = repos

    this.connectionHandler = new WorkerConnectionHandler(
      this.eventPublisher,
      () => this.repos,
      () => this.sock,
      () => this.syncFullHistory,
      () => this.isFreshLogin,
      (val) => { this.isFreshLogin = val },
      (delay) => this.scheduleReconnect(delay),
      () => this.wipeAndReconnect()
    )

    this.eventDispatcher = new WorkerEventDispatcher(
      () => this.repos,
      this.connectionHandler,
      () => this.syncFullHistory
    )
  }

  public async connect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.sock) {
      console.log('[WhatsAppWorker] Cleaning up previous socket instance before reconnecting...')
      try {
        const ev = this.sock.ev as unknown as { removeAllListeners?: () => void }
        ev.removeAllListeners?.()
        this.sock.end(new Error('Replaced by new socket instance'))
      } catch (err) {
        console.warn('[WhatsAppWorker] Error cleaning up old socket:', err)
      }
      this.sock = null
    }

    const repos = this.repos!
    const prisma = this.prisma!

    // Fail closed: a thrown error from hasCreds() (transient DB lock / I/O) is
    // NOT proof the user is logged out, and the branch below wipes the entire
    // local database. On error, assume creds exist and skip the wipe.
    let existingCreds = true
    try {
      existingCreds = await repos.authSettingsService.hasCreds()
    } catch (err) {
      console.error('[WhatsAppWorker] hasCreds() failed — assuming creds exist, skipping wipe:', err)
    }
    if (!existingCreds) {
      this.isFreshLogin = true
      await repos.authSettingsService.clearHistorySyncCompleted().catch((err) => {
        console.error('[WhatsAppWorker] failed to delete history_sync_completed flag:', err)
      })

      const orphanChats = await prisma.chat.count()
      if (orphanChats > 0) {
        console.log(`[WhatsAppWorker] No auth creds but found ${orphanChats} orphan chats — wiping stale data`)
        await this.wipeAllData(prisma, this.userDataPath)
      }
    }

    const { state, saveCreds } = await useLocalPrismaAuthState(prisma)
    let version: [number, number, number] = [2, 3000, 1035194821]
    try {
      console.log('[WhatsAppWorker] Fetching latest WhatsApp version from Baileys...')
      const latest = await fetchLatestBaileysVersion()
      version = latest.version as [number, number, number]
      console.log(`[WhatsAppWorker] Successfully fetched WA v${version.join('.')}`)
    } catch (err) {
      console.warn('[WhatsAppWorker] Failed to fetch latest WhatsApp version (possibly offline). Using fallback version.', err)
    }

    if (this.isFreshLogin) {
      await repos.authSettingsService.clearHistorySyncCompleted().catch((err) => {
        console.error('[WhatsAppWorker] fresh login authState deletion failed:', err)
      })
    }

    const isHistorySyncCompleted = await repos.authSettingsService.getHistorySyncCompleted()

    repos.historySyncManager.clear()

    const isInitialSyncInProgress = repos.historySyncManager.isInProgress
    const currentShouldSyncHistory = this.isFreshLogin || isInitialSyncInProgress || !isHistorySyncCompleted

    const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

    this.sock = connectSocket({
      version,
      state,
      syncFullHistory: this.syncFullHistory,
      currentShouldSyncHistory,
      groupCache,
      prisma
    })

    this.sock.ev.on('creds.update', saveCreds)

    // Register event dispatcher to route events
    this.eventDispatcher!.register(this.sock)
  }

  private static readonly RECONNECT_MAX_DELAY_MS = 60_000

  private scheduleReconnect(delay: number) {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }
    this.reconnectTimeout = setTimeout(() => {
      // connect() does real async work that can reject (Prisma open/query,
      // hasCreds(), chat.count(), wipeAllData). A floating rejection here would
      // silently kill the reconnect chain and strand the worker offline until
      // the app restarts — so catch it and schedule another attempt.
      this.connect().catch((err) => {
        const nextDelay = Math.min(delay * 2, WorkerConnectionManager.RECONNECT_MAX_DELAY_MS)
        console.error(
          `[WhatsAppWorker] Reconnect attempt failed — retrying in ${nextDelay}ms:`,
          err
        )
        this.scheduleReconnect(nextDelay)
      })
    }, delay)
  }

  private async wipeAndReconnect() {
    this.isFreshLogin = true
    try {
      await this.wipeAllData(this.prisma!, this.userDataPath)
    } catch (err) {
      console.error('[WhatsAppWorker] Error wiping data:', err)
    }
    try {
      await this.connect()
    } catch (err) {
      console.error('[WhatsAppWorker] Reconnect after wipe failed — rescheduling:', err)
      this.scheduleReconnect(WorkerConnectionManager.RECONNECT_MAX_DELAY_MS)
    }
  }

  private clearDirectory(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true })
        fs.mkdirSync(dirPath, { recursive: true })
      }
    } catch (e) {
      console.error(`[WhatsAppWorker] Failed to clear directory ${dirPath}:`, e)
    }
  }

  private async wipeAllData(prismaClient: PrismaClient, userPath: string): Promise<void> {
    const tables = await prismaClient.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'"
    )

    // FK enforcement can only be toggled outside a transaction (PRAGMA is a
    // no-op mid-transaction), so disable it here and restore it in `finally` —
    // the old code skipped the restore on any error, leaving FK enforcement
    // off for the rest of the connection's life.
    await prismaClient.$executeRawUnsafe('PRAGMA foreign_keys = OFF;')
    try {
      // One atomic transaction: either every table is emptied or none is. The
      // old per-DELETE loop could half-wipe the DB on a mid-loop failure and
      // then the caller would treat the inconsistent DB as valid.
      await prismaClient.$transaction(
        tables.map((table) =>
          prismaClient.$executeRawUnsafe(`DELETE FROM "${table.name}";`)
        )
      )
      // Best-effort: sqlite_sequence only exists when a table uses AUTOINCREMENT.
      await prismaClient.$executeRawUnsafe('DELETE FROM sqlite_sequence;').catch((err: unknown) => {
        console.warn('[WhatsAppWorker] sqlite_sequence reset skipped:', (err as Error)?.message || err)
      })
    } finally {
      await prismaClient.$executeRawUnsafe('PRAGMA foreign_keys = ON;').catch((err: unknown) => {
        console.error('[WhatsAppWorker] Failed to restore foreign_keys pragma:', err)
      })
    }

    this.clearDirectory(join(userPath, 'favourites'))
    this.clearDirectory(join(userPath, 'media'))
    this.clearDirectory(join(userPath, 'temp'))
    this.clearDirectory(join(userPath, 'temp_stickers'))

    console.log('[WhatsAppWorker] All database tables cleared (including AuthState).')
  }

  public shutdown() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.sock) {
      try {
        const ev = this.sock.ev as unknown as { removeAllListeners?: () => void }
        ev.removeAllListeners?.()
        this.sock.end(new Error('Shutdown'))
      } catch (err) {
        console.warn('[WhatsAppWorker] Error closing socket:', err)
      }
      this.sock = null
    }
    if (this.connectionHandler) {
      this.connectionHandler.resetCatchUp()
    }
  }
}
