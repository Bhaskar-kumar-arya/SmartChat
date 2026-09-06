import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContactCacheSyncSubscriber } from '../../../../services/whatsapp/subscribers/ContactCacheSyncSubscriber'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'

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

describe('ContactCacheSyncSubscriber', () => {
  let contactService: { clearCaches: ReturnType<typeof vi.fn> }
  let bus: MockEventBus

  beforeEach(() => {
    contactService = { clearCaches: vi.fn() }
    bus = new MockEventBus()
    new ContactCacheSyncSubscriber(contactService as any).register(bus)
  })

  it('flushes the main-process contact caches on wa-sync-complete (post-dedup staleness fix)', async () => {
    await bus.emit('wa-sync-complete', undefined)
    expect(contactService.clearCaches).toHaveBeenCalledTimes(1)
  })

  it('does not flush on unrelated events', async () => {
    await bus.emit('wa-sync-progress', { progress: 50 })
    expect(contactService.clearCaches).not.toHaveBeenCalled()
  })
})
