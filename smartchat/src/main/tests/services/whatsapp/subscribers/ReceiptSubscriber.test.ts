import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { ReceiptSubscriber } from '../../../../services/whatsapp/subscribers/ReceiptSubscriber'
import type { IReceiptService } from '../../../../services/whatsapp/IReceiptService'
import type { IMessageProcessingService } from '../../../../services/messages/IMessageProcessingService'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'
import type { MessageStatusEvent, ReceiptEvent, ReactionEvent } from '../../../../services/whatsapp/WAEventTypes'

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

describe('ReceiptSubscriber', () => {
  let receiptService: Mocked<IReceiptService>
  let messageProcessingService: Mocked<IMessageProcessingService>
  let bus: MockEventBus
  let subscriber: ReceiptSubscriber

  beforeEach(() => {
    receiptService = {
      processMessageStatusUpdate: vi.fn().mockResolvedValue(undefined),
      processMessageReceipt: vi.fn().mockResolvedValue(undefined),
      getMessageReceipts: vi.fn(),
    }

    messageProcessingService = {
      processIncomingMessage: vi.fn(),
      processAppendMessages: vi.fn(),
      processReaction: vi.fn().mockResolvedValue(undefined),
      processDeletedMessage: vi.fn(),
      processEditedMessage: vi.fn(),
    } as any

    bus = new MockEventBus()
    subscriber = new ReceiptSubscriber(receiptService, messageProcessingService)
    subscriber.register(bus)
  })

  it('should handle message:status', async () => {
    const event: MessageStatusEvent = {
      key: { id: '1' } as any,
      baileysStatus: 3
    } as any
    await bus.emit('message:status', event)
    expect(receiptService.processMessageStatusUpdate).toHaveBeenCalledWith(event.key, event.baileysStatus)
  })

  it('should handle receipt:update', async () => {
    const event: ReceiptEvent = {
      sock: {} as any,
      updates: [{ key: { id: '2' }, receipt: { readTimestamp: 123 } } as any]
    }
    await bus.emit('receipt:update', event)
    expect(receiptService.processMessageReceipt).toHaveBeenCalledWith(event.updates[0], event.sock)
  })

  it('should handle reaction:update', async () => {
    const event: ReactionEvent = {
      sock: {} as any,
      reactions: [{ key: { id: '3' }, reaction: { text: '👍' } } as any]
    }
    await bus.emit('reaction:update', event)
    expect(messageProcessingService.processReaction).toHaveBeenCalledWith(event.reactions[0], event.sock)
  })
})
