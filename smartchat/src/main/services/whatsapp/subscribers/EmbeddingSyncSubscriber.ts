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

  private onSyncProgress(payload: WASyncProgressPayload): void {
    if (payload.progress < 100) {
      this.embeddingService.setPaused(true)
    } else {
      console.log('[EmbeddingSyncSubscriber] Sync progress reached 100%. Unpausing embedding.')
      this.embeddingService.setPaused(false)
    }
  }

  private onSyncComplete(): void {
    console.log('[EmbeddingSyncSubscriber] WhatsApp sync/catchup completed. Unpausing embedding service.')
    this.embeddingService.setPaused(false)
  }
}
