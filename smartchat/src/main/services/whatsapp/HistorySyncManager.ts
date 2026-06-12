import { BrowserWindow } from 'electron'
import { PrismaClient } from '@prisma/client'
import { handleHistorySync } from '../../historySync'
import { WASocket } from '../../types'
import {
  SYNC_TYPE_INITIAL,
  SYNC_TYPE_FULL,
  SYNC_TYPE_RECENT,
  SYNC_TYPE_GROUP_HYDRATION,
  SYNC_AUTO_FINISH_THRESHOLD,
  HISTORY_SYNC_TIMEOUT_MS
} from '../../constants'
import type { ServiceContainer } from '../../ServiceContainer'

export class HistorySyncManager {
  private syncChunkCount = 0
  private maxProgress = 0
  private syncComplete = false
  private isInitialSyncInProgress = false
  private syncTimeout: NodeJS.Timeout | null = null

  constructor(
    private services: ServiceContainer,
    private getMainWindow: () => BrowserWindow | null,
    private prisma: PrismaClient
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
  }

  async handleSyncChunk(data: unknown, syncFullHistory: boolean, sock: WASocket): Promise<void> {
    try {
      this.services.embeddingService.setPaused(true)
      this.isInitialSyncInProgress = true
      this.syncChunkCount++
      const rawData = data as Record<string, unknown>
      const reportedProgress = typeof rawData.progress === 'number' ? rawData.progress : undefined
      const syncType = typeof rawData.syncType === 'number' ? rawData.syncType : undefined

      if (this.syncTimeout) clearTimeout(this.syncTimeout)
      this.syncTimeout = setTimeout(() => this.finishSync(sock, syncFullHistory), HISTORY_SYNC_TIMEOUT_MS)

      const syncResult = await handleHistorySync(
        data as any,
        this.prisma,
        this.services.contactService
      )

      // Post-sync processing: check and download favorite stickers in this batch
      this.services.mediaService.downloadFavoriteStickersFromSync(
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
      const groupKeys = Object.keys(groups)
      const totalGroups = groupKeys.length
      let groupCount = 0

      const mainWindow = this.getMainWindow()
      mainWindow?.webContents.send('wa-sync-progress', {
        progress: 95,
        syncType: SYNC_TYPE_GROUP_HYDRATION,
        syncFullHistory
      })
      mainWindow?.webContents.send('wa-sync-status', 'Fetching group metadata from WhatsApp...')

      for (const jid of groupKeys) {
        groupCount++
        if (groupCount % 5 === 0) {
          await new Promise(r => setImmediate(r))
          const groupProgress = 95 + Math.round((groupCount / totalGroups) * 4)
          mainWindow?.webContents.send('wa-sync-progress', {
            progress: groupProgress,
            syncType: SYNC_TYPE_GROUP_HYDRATION,
            syncFullHistory
          })
          mainWindow?.webContents.send('wa-sync-status', `Syncing group members... (${groupCount} / ${totalGroups})`)
        }
        const raw = groups[jid] as any
        await this.services.chatService.upsertChat(jid, raw).catch(() => { })
        if (raw.participants && raw.participants.length > 0) {
          await this.services.chatService.syncGroupMembers(jid, raw.participants).catch((err) => {
            console.error(`Failed to sync members for ${jid}:`, err)
          })
        }
      }
    } catch (err) {
      console.warn('[WhatsAppConnectionManager] Failed to sync community metadata:', err)
    }

    // Heal any LID-stub / PN-identity splits that formed during the sync
    console.log('[finishSync] Running post-sync identity deduplication...')
    await this.services.contactService.deduplicateIdentities().catch((err) => {
      console.warn('[finishSync] deduplicateIdentities error:', err)
    })

    // Unpause embedding service now that all syncing and deduplication are complete
    this.services.embeddingService.setPaused(false)

    // Persist the completed history sync status in AuthState
    await this.prisma.authState.upsert({
      where: { id: 'history_sync_completed' },
      update: { data: 'true' },
      create: { id: 'history_sync_completed', data: 'true' }
    }).catch((err) => {
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
    const fullHistoryRow = await this.prisma.authState.findUnique({
      where: { id: 'sync_full_history' }
    }).catch(() => null)
    const syncFullHistory = fullHistoryRow?.data === 'true'
    await this.finishSync(sock, syncFullHistory)
  }
}
