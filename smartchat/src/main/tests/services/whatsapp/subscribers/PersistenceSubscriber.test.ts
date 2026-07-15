import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { PersistenceSubscriber } from '../../../../services/whatsapp/subscribers/PersistenceSubscriber'
import type { IMessageWriterService } from '../../../../services/messages/IMessageWriterService'
import type { IChatService } from '../../../../services/chats/IChatService'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'
import type {
  IncomingMessageEvent,
  AppendMessagesEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  MessageDecryptedEvent,
  ChatUpdatedEvent,
  ChatUpsertedEvent
} from '../../../../services/whatsapp/WAEventTypes'

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

describe('PersistenceSubscriber', () => {
  let messageWriterService: Mocked<IMessageWriterService>
  let chatService: Mocked<IChatService>
  let bus: MockEventBus
  let subscriber: PersistenceSubscriber

  beforeEach(() => {
    messageWriterService = {
      bulkPersistMessages: vi.fn().mockResolvedValue(undefined),
      revokeMessageInDb: vi.fn().mockResolvedValue(undefined),
      editMessageInDb: vi.fn().mockResolvedValue(undefined),
      decryptMessageInDb: vi.fn().mockResolvedValue(undefined),
    } as any

    chatService = {
      upsertChat: vi.fn().mockResolvedValue(undefined),
      incrementUnread: vi.fn().mockResolvedValue(undefined),
      updateTimestamp: vi.fn().mockResolvedValue(undefined),
      deleteChat: vi.fn().mockResolvedValue(undefined),
      isChatMuted: vi.fn(),
      toggleMute: vi.fn(),
      toggleArchive: vi.fn(),
      togglePin: vi.fn(),
    } as any

    bus = new MockEventBus()
    subscriber = new PersistenceSubscriber(messageWriterService, chatService)
    subscriber.register(bus)
  })

  it('should handle messages:append', async () => {
    const event: AppendMessagesEvent = { sock: {} as any, messages: [] }
    await bus.emit('messages:append', event)
    expect(messageWriterService.bulkPersistMessages).toHaveBeenCalledWith([])
  })

  it('should increment unread for incoming non-fromMe messages', async () => {
    const event: IncomingMessageEvent = {
      sock: {} as any,
      chatJid: 'user@s.whatsapp.net',
      senderJid: 'user@s.whatsapp.net',
      messageType: 'conversation',
      fromMe: false,
      timestamp: 1000n,
      textContent: undefined,
      processed: undefined,
      enriched: {} as any
    } as any
    await bus.emit('message:incoming', event)
    expect(chatService.incrementUnread).toHaveBeenCalledWith('user@s.whatsapp.net', 1000n)
    expect(chatService.updateTimestamp).not.toHaveBeenCalled()
  })

  it('should update timestamp for incoming fromMe messages', async () => {
    const event: IncomingMessageEvent = {
      sock: {} as any,
      chatJid: 'user@s.whatsapp.net',
      senderJid: 'me@s.whatsapp.net',
      messageType: 'conversation',
      fromMe: true,
      timestamp: 2000n,
      textContent: undefined,
      processed: undefined,
      enriched: {} as any
    } as any
    await bus.emit('message:incoming', event)
    expect(chatService.updateTimestamp).toHaveBeenCalledWith('user@s.whatsapp.net', 2000n)
    expect(chatService.incrementUnread).not.toHaveBeenCalled()
  })

  it('should handle message:deleted', async () => {
    const event: MessageDeletedEvent = { messageId: '123', chatJid: 'user@s.whatsapp.net', fromMe: true } as any
    await bus.emit('message:deleted', event)
    expect(messageWriterService.revokeMessageInDb).toHaveBeenCalledWith('123')
  })

  it('should handle message:edited', async () => {
    const event: MessageEditedEvent = { messageId: '123', editedTextContent: 'new text', editedContent: null as any } as any
    await bus.emit('message:edited', event)
    expect(messageWriterService.editMessageInDb).toHaveBeenCalledWith('123', 'new text', null)
  })

  it('should handle message:decrypted', async () => {
    const event: MessageDecryptedEvent = { messageId: '123', messageType: 'conversation', textContent: 'text', content: {} as any } as any
    await bus.emit('message:decrypted', event)
    expect(messageWriterService.decryptMessageInDb).toHaveBeenCalledWith('123', 'conversation', 'text', {})
  })

  it('should handle chat:updated', async () => {
    const event: ChatUpdatedEvent = { jid: 'group@g.us', update: { subject: 'new' } } as any
    await bus.emit('chat:updated', event)
    expect(chatService.upsertChat).toHaveBeenCalledWith('group@g.us', { subject: 'new' })
  })

  it('should handle chat:upserted', async () => {
    const event: ChatUpsertedEvent = { jid: 'user@s.whatsapp.net', raw: { id: 'user@s.whatsapp.net' } as any } as any
    await bus.emit('chat:upserted', event)
    expect(chatService.upsertChat).toHaveBeenCalledWith('user@s.whatsapp.net', { id: 'user@s.whatsapp.net' })
  })
})
