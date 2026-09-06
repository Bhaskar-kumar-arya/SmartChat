import type { IWAEventBus } from '../IWAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type { IEmbeddingOperationalControl } from '../../search/IEmbeddingService'
import type { WASyncProgressPayload } from '../events/syncEvents'

/**
 * EmbeddingSyncSubscriber
 * =======================
 * Manages the embedding service pause state during active WhatsApp sync or catch-up.
 * Ensures the CPU/GPU embedding pipeline does not run concurrently with heavy DB ingestion.
 */
export class EmbeddingSyncSubscriber implements IWAEventSubscriber {
  constructor(
    private readonly embeddingService: IEmbeddingOperationalControl
  ) {}

  register(bus: IWAEventBus): void {
    bus.on('wa-connected', this.onSyncStart.bind(this))
    bus.on('wa-sync-progress', this.onSyncProgress.bind(this))
    bus.on('wa-sync-status', this.onSyncStart.bind(this))
    bus.on('wa-sync-complete', this.onSyncComplete.bind(this))
  }

  dispose(): void {
    // Bus cleanup handles listener removal
  }

  private onSyncStart(): void {
    console.log('[EmbeddingSyncSubscriber] WhatsApp sync/catchup started. Pausing embedding service.')
    this.embeddingService.setPaused(true)
  }

  private onSyncProgress(_payload: WASyncProgressPayload): void {
    // Any sync-progress event means ingestion is still active — keep the pipeline
    // paused. Do NOT unpause here: a payload with progress >= 100 can be an
    // intermediate signal (RECENT-sync chunk hitting 100, or a group-hydration
    // progress callback) that fires long before finishSync's deduplication runs.
    // Unpausing is owned solely by onSyncComplete (the authoritative done signal).
    this.embeddingService.setPaused(true)
  }

  private onSyncComplete(): void {
    console.log('[EmbeddingSyncSubscriber] WhatsApp sync/catchup completed. Unpausing embedding service.')
    this.embeddingService.setPaused(false)
  }
}
