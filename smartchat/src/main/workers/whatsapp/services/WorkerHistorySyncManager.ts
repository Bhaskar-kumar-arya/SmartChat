import { IHistorySyncManager } from '../../../services/whatsapp/IHistorySyncManager'
import { handleHistorySync, HistorySyncData } from '../../../historySync'
import { WASocket } from '../../../services/whatsapp/types'
import { IMediaService } from '../../../services/messages/IMediaService'
import { IContactQueryService, IContactMutationService, IContactCacheManager } from '../../../services/contacts/IContactService'
import { IAliasRepository } from '../../../services/contacts/IAliasRepository'
import { IChatRepository } from '../../../services/chats/IChatRepository'
import { ICommunityRepository } from '../../../services/chats/ICommunityRepository'
import { IMessageRepository } from '../../../services/messages/IMessageRepository'
import { IReactionRepository } from '../../../services/messages/IReactionRepository'
import { IEmbeddingOperationalControl } from '../../../services/search/IEmbeddingService'
import { IGroupHydrationService } from '../../../services/chats/IGroupHydrationService'
import { IIdentityReconciliationService } from '../../../services/contacts/IIdentityReconciliationService'
import { IAuthSettingsService } from '../../../services/auth/IAuthSettingsService'
import { IWorkerEventPublisher } from '../events/IWorkerEventPublisher'
import {
  SYNC_TYPE_INITIAL,
  SYNC_TYPE_FULL,
  SYNC_TYPE_RECENT,
  SYNC_TYPE_GROUP_HYDRATION,
  SYNC_AUTO_FINISH_THRESHOLD,
  HISTORY_SYNC_TIMEOUT_MS
} from '../../../constants'

export interface HistorySyncDependencies {
  mediaService: IMediaService
  embeddingService: IEmbeddingOperationalControl
  contactService: IContactQueryService & IContactMutationService & IContactCacheManager
  aliasRepository: IAliasRepository
  chatRepository: IChatRepository
  communityRepository: ICommunityRepository
  messageRepository: IMessageRepository
  reactionRepository: IReactionRepository
  groupHydrationService: IGroupHydrationService
  identityReconciliationService: IIdentityReconciliationService
}

export class WorkerHistorySyncManager implements IHistorySyncManager {
  private syncChunkCount = 0
  private maxProgress = 0
  private syncComplete = false
  private isInitialSyncInProgress = false
  private syncTimeout: NodeJS.Timeout | null = null
  // S3-03: number of handleSyncChunk calls currently writing to the DB. The
  // inactivity safety timer must only fire in a gap *between* chunks, and
  // finishSync must never run while ingestion is still in flight.
  private activeChunks = 0
  private pendingFinish = false

  constructor(
    private deps: HistorySyncDependencies,
    private readonly authSettingsService: IAuthSettingsService,
    private readonly eventPublisher: IWorkerEventPublisher
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
    this.activeChunks = 0
    this.pendingFinish = false
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }
    this.deps.mediaService.clearFavoriteStickerQueue()
  }

  async handleSyncChunk(data: unknown, syncFullHistory: boolean, sock: WASocket): Promise<void> {
    this.activeChunks++
    try {
      this.syncChunkCount++
      const rawData = data as Record<string, unknown>
      const reportedProgress = typeof rawData.progress === 'number' ? rawData.progress : undefined
      const syncType = typeof rawData.syncType === 'number' ? rawData.syncType : undefined

      if (!this.syncComplete) {
        this.deps.embeddingService.setPaused(true)
        this.deps.mediaService.setFavoriteStickerQueuePaused(true)
        this.isInitialSyncInProgress = true
        // Disarm the inactivity timer for the duration of this chunk's write —
        // it is re-armed in the finally once no chunk is in flight.
        if (this.syncTimeout) {
          clearTimeout(this.syncTimeout)
          this.syncTimeout = null
        }
      }

      const syncResult = await handleHistorySync(
        data as HistorySyncData,
        this.deps.contactService,
        this.deps.aliasRepository,
        this.deps.chatRepository,
        this.deps.communityRepository,
        this.deps.messageRepository,
        this.deps.reactionRepository
      )

      this.deps.mediaService.downloadFavoriteStickersFromSync(
        syncResult.importedMessages,
        sock
      ).catch((err) => {
        console.error('[WorkerHistorySync] Failed to process favorite stickers from sync:', err)
      })

      if (this.syncComplete) {
        return // Do not broadcast progress updates if the initial sync phase is already complete
      }

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
        this.eventPublisher.publish('wa-sync-progress', {
          progress: this.maxProgress,
          syncType,
          syncFullHistory
        })
        if (this.maxProgress >= SYNC_AUTO_FINISH_THRESHOLD) {
          await this.finishSync(sock, syncFullHistory)
        }
      }
    } catch (err) {
      console.error('[WorkerHistorySync] Error processing sync payload:', err)
    } finally {
      this.activeChunks--
      if (this.activeChunks === 0 && !this.syncComplete) {
        if (this.pendingFinish) {
          this.pendingFinish = false
          await this.finishSync(sock, syncFullHistory).catch((err) => {
            console.error('[WorkerHistorySync] Deferred finishSync failed:', err)
          })
        } else {
          if (this.syncTimeout) clearTimeout(this.syncTimeout)
          this.syncTimeout = setTimeout(() => this.finishSync(sock, syncFullHistory), HISTORY_SYNC_TIMEOUT_MS)
        }
      }
    }
  }

  async finishSync(sock: WASocket, syncFullHistory: boolean): Promise<'completed' | 'deferred'> {
    if (this.syncComplete) return 'completed'
    if (this.activeChunks > 0) {
      // A chunk is still writing to the DB. Defer completion (dedup, group
      // hydration, history_sync_completed) until it settles — running them now
      // would corrupt identity dedup against a half-imported dataset and persist
      // history_sync_completed before the sync actually finished.
      this.pendingFinish = true
      return 'deferred'
    }
    this.syncComplete = true
    this.isInitialSyncInProgress = false
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }
    console.log(`[WorkerHistorySync] Sync complete after ${this.syncChunkCount} chunks`)

    try {
      const groups = await sock.groupFetchAllParticipating()

      this.eventPublisher.publish('wa-sync-progress', {
        progress: 95,
        syncType: SYNC_TYPE_GROUP_HYDRATION,
        syncFullHistory
      })
      this.eventPublisher.publish('wa-sync-status', 'Fetching group metadata from WhatsApp...')
      await this.deps.groupHydrationService.hydrateGroups(groups, (progress, status) => {
        this.eventPublisher.publish('wa-sync-progress', {
          progress,
          syncType: SYNC_TYPE_GROUP_HYDRATION,
          syncFullHistory
        })
        this.eventPublisher.publish('wa-sync-status', status)
      }).catch((err) => {
        console.error('[WorkerHistorySync] Group hydration failed:', err)
      })
    } catch (err) {
      console.warn('[WorkerHistorySync] Failed to sync community metadata:', err)
    }

    console.log('[WorkerHistorySync] Running post-sync identity reconciliation...')
    await this.deps.identityReconciliationService.deduplicateIdentities().catch((err) => {
      console.warn('[WorkerHistorySync] deduplicateIdentities error:', err)
    })

    this.deps.contactService.clearCaches()

    this.deps.embeddingService.setPaused(false)
    this.deps.mediaService.setFavoriteStickerQueuePaused(false)

    await this.authSettingsService.setHistorySyncCompleted().catch((err) => {
      console.error('[WorkerHistorySync] Failed to save history sync complete status:', err)
    })

    this.eventPublisher.publish('wa-sync-progress', {
      progress: 100,
      syncType: SYNC_TYPE_GROUP_HYDRATION,
      syncFullHistory
    })
    this.eventPublisher.publish('wa-sync-complete')
    return 'completed'
  }

  async skipSync(sock: WASocket): Promise<'completed' | 'deferred'> {
    const syncFullHistory = await this.authSettingsService.getSyncFullHistory()
    return this.finishSync(sock, syncFullHistory)
  }
}
