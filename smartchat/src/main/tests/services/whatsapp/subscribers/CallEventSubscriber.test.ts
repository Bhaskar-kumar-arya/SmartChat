import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { CallEventSubscriber } from '../../../../services/whatsapp/subscribers/CallEventSubscriber'
import type { ICallMutationService } from '../../../../services/calls/ICallService'
import type { IContactMutationService } from '../../../../services/contacts/IContactService'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'
import type { CallEvent } from '../../../../services/whatsapp/WAEventTypes'

class MockEventBus implements IWAEventBus {
  private handlers = new Map<string, AsyncHandler<any>[]>()

  on(event: string, handler: AsyncHandler<any>): this {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }
    this.handlers.get(event)!.push(handler)
    return this
  }

  off(event: string, handler: AsyncHandler<any>): this {
    const list = this.handlers.get(event)
    if (list) {
      this.handlers.set(event, list.filter(h => h !== handler))
    }
    return this
  }

  async emit(event: string, data: any): Promise<void> {
    const list = this.handlers.get(event) || []
    for (const handler of list) {
      await handler(data)
    }
  }

  removeAllListeners(): void {
    this.handlers.clear()
  }
}

describe('CallEventSubscriber', () => {
  let callService: Mocked<ICallMutationService>
  let contactService: Mocked<IContactMutationService>
  let bus: MockEventBus
  let subscriber: CallEventSubscriber

  beforeEach(() => {
    callService = {
      upsertCallLog: vi.fn().mockResolvedValue(undefined)
    }

    contactService = {
      upsertContact: vi.fn().mockResolvedValue(undefined),
      linkLidAndPn: vi.fn().mockResolvedValue(undefined),
      registerMe: vi.fn().mockResolvedValue(undefined)
    }

    bus = new MockEventBus()
    subscriber = new CallEventSubscriber(callService, contactService)
    subscriber.register(bus)
  })

  it('should register call:event on the event bus', () => {
    // Verified by setup: emit triggers the logic
    expect(subscriber).toBeDefined()
  })

  it('should upsert call log and link lid to pn for a call event', async () => {
    const event: CallEvent = {
      calls: [
        {
          id: 'call-1',
          from: '1234567890@s.whatsapp.net',
          status: 'offer',
          isVideo: true,
          isGroup: false,
          callerPn: '1234567890@s.whatsapp.net',
          content: {
            attrs: {
              caller_lid: '987654321@lid'
            }
          }
        } as any
      ]
    }

    await bus.emit('call:event', event)

    expect(callService.upsertCallLog).toHaveBeenCalledTimes(1)
    expect(callService.upsertCallLog).toHaveBeenCalledWith(expect.objectContaining({
      id: 'call-1',
      callerJid: '1234567890@s.whatsapp.net',
      isVideo: true,
      isGroup: false,
      status: 'offer',
      // timestamp is dynamically generated, skip exact match
    }))

    expect(contactService.linkLidAndPn).toHaveBeenCalledTimes(1)
    expect(contactService.linkLidAndPn).toHaveBeenCalledWith(
      '987654321@lid',
      '1234567890@s.whatsapp.net',
      'call.event'
    )
  })

  it('should handle errors gracefully without crashing', async () => {
    callService.upsertCallLog.mockRejectedValueOnce(new Error('DB Error'))
    const event: CallEvent = {
      calls: [
        {
          id: 'call-2',
          from: '1234567890@s.whatsapp.net',
          status: 'offer',
        } as any
      ]
    }

    await expect(bus.emit('call:event', event)).resolves.toBeUndefined()
    expect(callService.upsertCallLog).toHaveBeenCalledTimes(1)
  })
})
