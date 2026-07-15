import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { EmbeddingSyncSubscriber } from '../../../../services/whatsapp/subscribers/EmbeddingSyncSubscriber'
import type { IEmbeddingOperationalControl } from '../../../../services/search/IEmbeddingService'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'
import type { WASyncProgressPayload } from '../../../../services/whatsapp/events/syncEvents'

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

describe('EmbeddingSyncSubscriber', () => {
  let embeddingService: Mocked<IEmbeddingOperationalControl>
  let bus: MockEventBus
  let subscriber: EmbeddingSyncSubscriber

  beforeEach(() => {
    embeddingService = {
      setPaused: vi.fn()
    } as any

    bus = new MockEventBus()
    subscriber = new EmbeddingSyncSubscriber(embeddingService)
    subscriber.register(bus)
  })

  it('should pause embedding on wa-connected', async () => {
    await bus.emit('wa-connected', undefined)
    expect(embeddingService.setPaused).toHaveBeenCalledWith(true)
  })

  it('should pause embedding when progress < 100', async () => {
    const payload: WASyncProgressPayload = { progress: 50 } as any
    await bus.emit('wa-sync-progress', payload)
    expect(embeddingService.setPaused).toHaveBeenCalledWith(true)
  })

  it('should unpause embedding when progress is 100', async () => {
    const payload: WASyncProgressPayload = { progress: 100 } as any
    await bus.emit('wa-sync-progress', payload)
    expect(embeddingService.setPaused).toHaveBeenCalledWith(false)
  })

  it('should unpause embedding on wa-sync-complete', async () => {
    await bus.emit('wa-sync-complete', undefined)
    expect(embeddingService.setPaused).toHaveBeenCalledWith(false)
  })
})
