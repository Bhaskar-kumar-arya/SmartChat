import type { WASocket } from '@whiskeysockets/baileys'
import { DisconnectReason } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { IWorkerBootstrap } from '../IWorkerBootstrap'
import { IWorkerEventPublisher } from '../events/IWorkerEventPublisher'
import { RECONNECT_DELAY_RESTART_MS, RECONNECT_DELAY_DEFAULT_MS } from '../../../constants'

/**
 * WorkerConnectionHandler
 * =======================
 * Manages the reaction to socket state updates, specifically connection lifecycle states,
 * QR code events, catch-up tracking for reconnects, and logout triggers.
 */
export class WorkerConnectionHandler {
  private isWaitingForCatchUp = false
  private catchUpTimeout: NodeJS.Timeout | null = null
  private hasReceivedPendingNotifications = false

  constructor(
    private readonly eventPublisher: IWorkerEventPublisher,
    private readonly reposGetter: () => IWorkerBootstrap | null,
    private readonly sockGetter: () => WASocket | null,
    private readonly getSyncFullHistory: () => boolean,
    private readonly getIsFreshLogin: () => boolean,
    private readonly setIsFreshLogin: (val: boolean) => void,
    private readonly onReconnect: (delay: number) => void,
    private readonly onWipeAndConnect: () => void
  ) {}

  public getWaitingForCatchUp(): boolean {
    return this.isWaitingForCatchUp
  }

  public getHasReceivedPendingNotifications(): boolean {
    return this.hasReceivedPendingNotifications
  }

  public setHasReceivedPendingNotifications(val: boolean) {
    this.hasReceivedPendingNotifications = val
  }

  public startCatchUp() {
    console.log('[WhatsAppWorker] Reconnect: history sync previously completed. Waiting for offline catch-up...')
    this.isWaitingForCatchUp = true

    this.eventPublisher.publish('wa-connected')

    if (this.catchUpTimeout) {
      clearTimeout(this.catchUpTimeout)
    }

    this.catchUpTimeout = setTimeout(() => {
      console.warn('[WhatsAppWorker] Catch-up safety timeout reached. Forcing transition.')
      this.completeCatchUp()
    }, 30000)

    this.eventPublisher.publish('wa-sync-status', 'Syncing missed messages...')
  }

  public completeCatchUp() {
    if (!this.isWaitingForCatchUp) return
    this.isWaitingForCatchUp = false

    if (this.catchUpTimeout) {
      clearTimeout(this.catchUpTimeout)
      this.catchUpTimeout = null
    }

    console.log('[WhatsAppWorker] Catch-up finished. Unpausing embedding and completing sync.')

    const syncFullHistory = this.getSyncFullHistory()
    this.eventPublisher.publish('wa-sync-progress', {
      progress: 100,
      syncType: 6,
      syncFullHistory
    })

    this.eventPublisher.publish('wa-sync-complete')
  }

  public resetCatchUp() {
    if (this.catchUpTimeout) {
      clearTimeout(this.catchUpTimeout)
      this.catchUpTimeout = null
    }
    this.isWaitingForCatchUp = false
    this.hasReceivedPendingNotifications = false
  }

  public async handleConnectionUpdate(update: any) {
    const { connection, lastDisconnect, qr, receivedPendingNotifications } = update
    const repos = this.reposGetter()
    const sock = this.sockGetter()
    const syncFullHistory = this.getSyncFullHistory()

    if (receivedPendingNotifications !== undefined) {
      this.hasReceivedPendingNotifications = receivedPendingNotifications
      if (receivedPendingNotifications === true && this.isWaitingForCatchUp) {
        console.log('[WhatsAppWorker] Received pending notifications (catch-up complete).')
        this.completeCatchUp()
      }
    }

    if (qr) {
      console.log('[WhatsAppWorker] Got QR string:', qr)
      this.setIsFreshLogin(true)
      this.eventPublisher.publish('wa-qr', qr)
    }

    if (connection === 'close') {
      this.resetCatchUp()
      const lastDisconnectObj = lastDisconnect as Record<string, unknown> | null | undefined
      const statusCode = (lastDisconnectObj?.error as Boom | undefined)?.output?.statusCode
      const errorData = (lastDisconnectObj?.error as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined
      const isConflict = statusCode === 440 || statusCode === 409 || errorData?.tag === 'conflict'
      const isRestartRequired = statusCode === DisconnectReason.restartRequired
      const shouldReconnect = (statusCode !== DisconnectReason.loggedOut && !isConflict) || isRestartRequired

      console.log(`[WhatsAppWorker] Closed | statusCode=${statusCode} | isRestart=${isRestartRequired} | isConflict=${isConflict} | shouldReconnect=${shouldReconnect}`)

      if (shouldReconnect) {
        const delay = isRestartRequired ? RECONNECT_DELAY_RESTART_MS : RECONNECT_DELAY_DEFAULT_MS
        console.log(`[WhatsAppWorker] Scheduling reconnect in ${delay}ms...`)
        this.onReconnect(delay)
      } else if (isConflict) {
        console.warn('[WhatsAppWorker] Replaced by another session (440 conflict). Standing down.')
      } else {
        console.log('[WhatsAppWorker] Logged out — wiping all data for fresh QR...')
        this.eventPublisher.publish('wa-logged-out')
        this.onWipeAndConnect()
      }
    } else if (connection === 'open') {
      console.log('[WhatsAppWorker] Connected to WhatsApp!')
      if (sock && sock.user && repos) {
        await repos.contactService.registerMe(sock.user).catch((err) => {
          console.error('[WhatsAppWorker] Failed to register logged-in user identity:', err)
        })
      }

      if (repos) {
        const isSyncInProgress = repos.historySyncManager.isInProgress
        const isFreshLogin = this.getIsFreshLogin()
        if (!isFreshLogin && !isSyncInProgress) {
          const isHistorySyncCompleted = await repos.authSettingsService.getHistorySyncCompleted()

          if (isHistorySyncCompleted) {
            if (this.hasReceivedPendingNotifications) {
              console.log('[WhatsAppWorker] Already received pending notifications. Skipping catchup.')
              this.eventPublisher.publish('wa-sync-progress', {
                progress: 100,
                syncType: 6,
                syncFullHistory
              })
              this.eventPublisher.publish('wa-sync-complete')
            } else {
              this.startCatchUp()
            }
          } else {
            console.log('[WhatsAppWorker] Reconnect: history sync NOT completed, continuing sync')
            this.eventPublisher.publish('wa-connected')
          }
        } else {
          console.log('[WhatsAppWorker] Fresh login or active sync reconnect detected, showing/continuing sync screen')
          repos.historySyncManager.setInProgress(true)
          this.setIsFreshLogin(false)
          this.eventPublisher.publish('wa-connected')
        }
      }
    }

    const safeUpdate = { ...update } as Record<string, unknown>
    if (safeUpdate.lastDisconnect) {
      const lastDisconnectObj = safeUpdate.lastDisconnect as Record<string, unknown>
      const errorObj = lastDisconnectObj.error as Record<string, unknown> | null | undefined
      lastDisconnectObj.error = errorObj
        ? {
            message: String(errorObj.message || errorObj),
            stack: typeof errorObj.stack === 'string' ? errorObj.stack : undefined,
            output: errorObj.output || undefined
          }
        : undefined
    }
    this.eventPublisher.publish('connection.update', safeUpdate)
  }
}
