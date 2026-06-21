import { BrowserWindow } from 'electron'
import { handleHistorySync, HistorySyncData } from '../../historySync'
import { WASocket } from './types'
import {
  SYNC_TYPE_INITIAL,
  SYNC_TYPE_FULL,
  SYNC_TYPE_RECENT,
  SYNC_TYPE_GROUP_HYDRATION,
  SYNC_AUTO_FINISH_THRESHOLD,
  HISTORY_SYNC_TIMEOUT_MS
} from '../../constants'
import type { IAuthSettingsService } from '../auth/IAuthSettingsService'
import type { IContactService } from '../contacts/IContactService'
import type { IAliasRepository } from '../contacts/IAliasRepository'
import type { IChatRepository } from '../chats/IChatRepository'
import type { ICommunityRepository } from '../chats/ICommunityRepository'
import type { IMessageRepository } from '../messages/IMessageRepository'
import type { IReactionRepository } from '../messages/IReactionRepository'
import type { IMediaService } from '../messages/IMediaService'
import type { IEmbeddingOperationalControl } from '../search/IEmbeddingService'
import type { IGroupHydrationService } from '../chats/IGroupHydrationService'
import type { IIdentityReconciliationService } from '../contacts/IIdentityReconciliationService'
import { IHistorySyncManager } from './IHistorySyncManager'

export interface HistorySyncDependencies {
  mediaService: IMediaService
  embeddingService: IEmbeddingOperationalControl
  contactService: IContactService
  aliasRepository: IAliasRepository
  chatRepository: IChatRepository
  communityRepository: ICommunityRepository
  messageRepository: IMessageRepository
  reactionRepository: IReactionRepository
  groupHydrationService: IGroupHydrationService
  identityReconciliationService: IIdentityReconciliationService
}

export class HistorySyncManager implements IHistorySyncManager {
  private syncChunkCount = 0
  private maxProgress = 0
  private syncComplete = false
  private isInitialSyncInProgress = false
  private syncTimeout: NodeJS.Timeout | null = null

  constructor(
    private deps: HistorySyncDependencies,
    private getMainWindow: () => BrowserWindow | null,
    private readonly authSettingsService: IAuthSettingsService
  ) {}

  public get isComplete(): boolean {
    return this.syncComplete
  }

  public get isInProgress(): boolean {
    return this.isInitialSyncInProgress
  }

  public setInProgress(val: boolean): void {
    this.isInitialSyncInProgress = val
  }

  public clear(): void {
    this.syncChunkCount = 0
    this.maxProgress = 0
    this.syncComplete = false
    this.isInitialSyncInProgress = false
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }
    this.deps.mediaService.clearFavoriteStickerQueue()
  }

  async handleSyncChunk(data: unknown, syncFullHistory: boolean, sock: WASocket): Promise<void> {
    try {
      this.deps.embeddingService.setPaused(true)
      this.deps.mediaService.setFavoriteStickerQueuePaused(true)
      this.isInitialSyncInProgress = true
      this.syncChunkCount++
      const rawData = data as Record<string, unknown>
      const reportedProgress = typeof rawData.progress === 'number' ? rawData.progress : undefined
      const syncType = typeof rawData.syncType === 'number' ? rawData.syncType : undefined

      if (this.syncTimeout) clearTimeout(this.syncTimeout)
      this.syncTimeout = setTimeout(() => this.finishSync(sock, syncFullHistory), HISTORY_SYNC_TIMEOUT_MS)

      const syncResult = await handleHistorySync(
        data as HistorySyncData,
        this.deps.contactService,
        this.deps.aliasRepository,
        this.deps.chatRepository,
        this.deps.communityRepository,
        this.deps.messageRepository,
        this.deps.reactionRepository
      )

      // Post-sync processing: check and download favorite stickers in this batch
      this.deps.mediaService.downloadFavoriteStickersFromSync(
        syncResult.importedMessages,
        sock
      ).catch((err) => {
        console.error('[HistorySync] Failed to process favorite stickers from sync:', err)
      })

      const mainWindow = this.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed() && !this.syncComplete) {
        let calculatedProgress: number | undefined = undefined

        if (reportedProgress !== undefined) {
          if (syncType === SYNC_TYPE_INITIAL) {
            calculatedProgress = 0
          } else if (syncType === SYNC_TYPE_RECENT) {
            const min = 0
            const max = syncFullHistory ? 30 : 100
            calculatedProgress = Math.round(min + (reportedProgress / 100) * (max - min))
          } else if (syncType === SYNC_TYPE_FULL) {
            if (syncFullHistory) {
              const min = 30
              const max = 100
              calculatedProgress = Math.round(min + (reportedProgress / 100) * (max - min))
            }
          }
        }

        if (calculatedProgress !== undefined) {
          this.maxProgress = Math.max(this.maxProgress, calculatedProgress)
          mainWindow.webContents.send('wa-sync-progress', {
            progress: this.maxProgress,
            syncType,
            syncFullHistory
          })
          if (this.maxProgress >= SYNC_AUTO_FINISH_THRESHOLD) {
            await this.finishSync(sock, syncFullHistory)
          }
        }
      }
    } catch (err) {
      console.error('[HistorySync] Error processing sync payload:', err)
    }
  }

  async finishSync(sock: WASocket, syncFullHistory: boolean): Promise<void> {
    if (this.syncComplete) return
    this.syncComplete = true
    this.isInitialSyncInProgress = false
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }
    console.log(`[HistorySync] Sync complete after ${this.syncChunkCount} chunks`)

    try {
      const groups = await sock.groupFetchAllParticipating()

      const mainWindow = this.getMainWindow()
      mainWindow?.webContents.send('wa-sync-progress', {
        progress: 95,
        syncType: SYNC_TYPE_GROUP_HYDRATION,
        syncFullHistory
      })
      mainWindow?.webContents.send('wa-sync-status', 'Fetching group metadata from WhatsApp...')
      await this.deps.groupHydrationService.hydrateGroups(groups, (progress, status) => {
        mainWindow?.webContents.send('wa-sync-progress', {
          progress,
          syncType: SYNC_TYPE_GROUP_HYDRATION,
          syncFullHistory
        })
        mainWindow?.webContents.send('wa-sync-status', status)
      }).catch((err) => {
        console.error('[HistorySync] Group hydration failed:', err)
      })
    } catch (err) {
      console.warn('[WhatsAppConnectionManager] Failed to sync community metadata:', err)
    }

    // Heal any LID-stub / PN-identity splits that formed during the sync
    console.log('[finishSync] Running post-sync identity deduplication...')
    await this.deps.identityReconciliationService.deduplicateIdentities().catch((err) => {
      console.warn('[finishSync] deduplicateIdentities error:', err)
    })

    // After deduplication, stale identityIds in the ContactService cache will point to
    // now-deleted stub identities. Clear the cache so all subsequent lookups (e.g. from
    // live group:updated events) resolve fresh canonical ids from the database.
    this.deps.contactService.clearCaches()

    // Unpause embedding service now that all syncing and deduplication are complete
    this.deps.embeddingService.setPaused(false)
    this.deps.mediaService.setFavoriteStickerQueuePaused(false)

    // Persist the completed history sync status in AuthState
    await this.authSettingsService.setHistorySyncCompleted().catch((err) => {
      console.error('Failed to save history sync complete status:', err)
    })

    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wa-sync-progress', {
        progress: 100,
        syncType: SYNC_TYPE_GROUP_HYDRATION,
        syncFullHistory
      })
      mainWindow.webContents.send('wa-sync-complete')
    }
  }

  async skipSync(sock: WASocket): Promise<void> {
    const syncFullHistory = await this.authSettingsService.getSyncFullHistory()
    await this.finishSync(sock, syncFullHistory)
  }
}
