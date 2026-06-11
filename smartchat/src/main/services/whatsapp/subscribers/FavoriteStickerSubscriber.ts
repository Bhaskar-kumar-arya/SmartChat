/**
 * FavoriteStickerSubscriber
 * =========================
 * Listens for app-state sync events and handles the synchronization (download
 * and database mapping) of favorite stickers.
 */

import type { WAEventBus } from '../WAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type { FavoriteStickerSyncEvent } from '../WAEventTypes'
import type { ServiceContainer } from '../../../ServiceContainer'

export class FavoriteStickerSubscriber implements IWAEventSubscriber {
  private onFavoriteStickerSyncBound: (e: FavoriteStickerSyncEvent) => Promise<void>

  constructor(private services: ServiceContainer) {
    this.onFavoriteStickerSyncBound = this.onFavoriteStickerSync.bind(this)
  }

  register(bus: WAEventBus): void {
    bus.on('app-state:favorite-sticker', this.onFavoriteStickerSyncBound)
  }

  dispose(): void {
    // Bus handles listener removal
  }

  private async onFavoriteStickerSync(event: FavoriteStickerSyncEvent): Promise<void> {
    const { fileSha256, isFavorite, stickerAction, sock } = event

    if (!isFavorite) {
      console.log(`[FavoriteStickerSubscriber] Sticker un-favorited on phone: ${fileSha256}`)
      try {
        await this.services.favoriteStickerService.removeFavoriteStickerBySha(fileSha256)
      } catch (err) {
        console.error('[FavoriteStickerSubscriber] Failed to remove un-favorited sticker:', err)
      }
    } else if (stickerAction) {
      console.log(`[FavoriteStickerSubscriber] Sticker favorited on phone: ${fileSha256}`)
      // Asynchronously sync the favorite sticker to avoid blocking other events on the bus
      this.services.favoriteStickerService.syncFavoriteSticker(fileSha256, stickerAction, sock)
        .catch((err) => {
          console.error('[FavoriteStickerSubscriber] Failed to sync favorite sticker:', err)
        })
    }
  }
}
