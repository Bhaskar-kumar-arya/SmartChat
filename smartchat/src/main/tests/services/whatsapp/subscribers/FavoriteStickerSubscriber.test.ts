import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { FavoriteStickerSubscriber } from '../../../../services/whatsapp/subscribers/FavoriteStickerSubscriber'
import type { IFavoriteStickerService } from '../../../../services/messages/IFavoriteStickerService'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'
import type { FavoriteStickerSyncEvent } from '../../../../services/whatsapp/WAEventTypes'

class MockEventBus implements IWAEventBus {
  private handlers = new Map<string, AsyncHandler<any>[]>()
  on(event: string, handler: AsyncHandler<any>): this {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
    return this
  }
  off(event: string, handler: AsyncHandler<any>): this {
    const list = this.handlers.get(event)
    if (list) this.handlers.set(event, list.filter(h => h !== handler))
    return this
  }
  async emit(event: string, data: any): Promise<void> {
    const list = this.handlers.get(event) || []
    for (const handler of list) await handler(data)
  }
  removeAllListeners(): void { this.handlers.clear() }
}

describe('FavoriteStickerSubscriber', () => {
  let favoriteStickerService: Mocked<IFavoriteStickerService>
  let bus: MockEventBus
  let subscriber: FavoriteStickerSubscriber

  beforeEach(() => {
    favoriteStickerService = {
      syncFavoriteSticker: vi.fn().mockResolvedValue(undefined),
      removeFavoriteStickerBySha: vi.fn().mockResolvedValue(undefined),
      getFavoriteStickers: vi.fn(),
      isStickerFavorite: vi.fn(),
    } as any

    bus = new MockEventBus()
    subscriber = new FavoriteStickerSubscriber(favoriteStickerService)
    subscriber.register(bus)
  })

  it('should handle un-favorite (isFavorite = false)', async () => {
    const event: FavoriteStickerSyncEvent = {
      sock: {} as any,
      fileSha256: 'some-sha',
      isFavorite: false,
      stickerAction: null
    }
    await bus.emit('app-state:favorite-sticker', event)
    expect(favoriteStickerService.removeFavoriteStickerBySha).toHaveBeenCalledWith('some-sha')
    expect(favoriteStickerService.syncFavoriteSticker).not.toHaveBeenCalled()
  })

  it('should handle favorite (isFavorite = true, has action)', async () => {
    const event: FavoriteStickerSyncEvent = {
      sock: {} as any,
      fileSha256: 'some-sha2',
      isFavorite: true,
      stickerAction: { someAction: true }
    }
    await bus.emit('app-state:favorite-sticker', event)
    expect(favoriteStickerService.syncFavoriteSticker).toHaveBeenCalledWith(
      'some-sha2',
      { someAction: true },
      event.sock
    )
    expect(favoriteStickerService.removeFavoriteStickerBySha).not.toHaveBeenCalled()
  })
})
