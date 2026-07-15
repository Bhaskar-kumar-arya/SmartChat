import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { UIBroadcastSubscriber } from '../../../../services/whatsapp/subscribers/UIBroadcastSubscriber'
import type { IContactNameResolver } from '../../../../services/contacts/IContactService'
import type { IMessageQueryService } from '../../../../services/messages/IMessageQueryService'
import type { IMessageReadRepository } from '../../../../services/messages/IMessageQueryRepository'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'
import { BrowserWindow } from 'electron'
import type { IncomingMessageEvent, MessageDeletedEvent, MessageEditedEvent, ChatUpdatedEvent, PresenceEvent, MessageStatusUpdatedEvent, ReactionProcessedEvent } from '../../../../services/whatsapp/WAEventTypes'

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

describe('UIBroadcastSubscriber', () => {
  let contactService: Mocked<IContactNameResolver>
  let messageQueryService: Mocked<IMessageQueryService>
  let messageQueryRepository: Mocked<IMessageReadRepository>
  let mockWebContents: { send: ReturnType<typeof vi.fn> }
  let mockWindow: BrowserWindow
  let bus: MockEventBus
  let subscriber: UIBroadcastSubscriber

  beforeEach(() => {
    contactService = {
      batchResolveNames: vi.fn().mockResolvedValue(new Map([['user@s.whatsapp.net', 'Test User']])),
    } as any

    messageQueryService = {
      enrichMessage: vi.fn().mockResolvedValue({ id: 'enriched-1' }),
    } as any

    messageQueryRepository = {
      findMessageById: vi.fn().mockResolvedValue({ id: '1', chatJid: 'user@s.whatsapp.net', messageType: 'conversation', content: '{"text": "old"}' }),
    } as any

    mockWebContents = { send: vi.fn() }
    mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: mockWebContents
    } as unknown as BrowserWindow

    const getMainWindow = () => mockWindow

    bus = new MockEventBus()
    subscriber = new UIBroadcastSubscriber(
      contactService,
      messageQueryService,
      messageQueryRepository,
      getMainWindow
    )
    subscriber.register(bus)
  })

  it('should broadcast new-message on message:incoming', async () => {
    const event: IncomingMessageEvent = {
      sock: {} as any,
      messageId: '1',
      chatJid: 'user@s.whatsapp.net',
      senderJid: 'user@s.whatsapp.net',
      messageType: 'conversation',
      fromMe: false,
      timestamp: 1000n,
      enriched: { id: '1', text: 'hello' } as any
    } as any
    await bus.emit('message:incoming', event)
    expect(mockWebContents.send).toHaveBeenCalledWith('new-message', event.enriched)
  })

  it('should broadcast message-deleted on message:deleted', async () => {
    const event: MessageDeletedEvent = {
      messageId: '123',
      chatJid: 'user@s.whatsapp.net',
      fromMe: true
    } as any
    await bus.emit('message:deleted', event)
    expect(mockWebContents.send).toHaveBeenCalledWith('message-deleted', {
      id: '123', chatJid: 'user@s.whatsapp.net', fromMe: true
    })
  })

  it('should broadcast message-edited on message:edited', async () => {
    const event: MessageEditedEvent = {
      messageId: '1',
      editedTextContent: 'new text',
      editedContent: null as any
    } as any
    await bus.emit('message:edited', event)
    expect(messageQueryRepository.findMessageById).toHaveBeenCalledWith('1')
    expect(messageQueryService.enrichMessage).toHaveBeenCalled()
    expect(mockWebContents.send).toHaveBeenCalledWith('message-edited', { id: 'enriched-1' })
  })

  it('should broadcast chat-updated on chat:updated', async () => {
    const event: ChatUpdatedEvent = {
      jid: 'group@g.us',
      update: { subject: 'new', pinned: 12345 } as any
    } as any
    await bus.emit('chat:updated', event)
    expect(mockWebContents.send).toHaveBeenCalledWith('chat-updated', {
      jid: 'group@g.us',
      subject: 'new',
      pinned: 12345
    })
  })

  it('should broadcast presence-update on presence:update', async () => {
    const event: PresenceEvent = {
      sock: {} as any,
      id: 'user@s.whatsapp.net',
      presences: { 'user@s.whatsapp.net': { lastSeen: 123456789 } as any }
    }
    await bus.emit('presence:update', event)
    expect(contactService.batchResolveNames).toHaveBeenCalledWith(['user@s.whatsapp.net'], event.sock)
    expect(mockWebContents.send).toHaveBeenCalledWith('presence-update', expect.objectContaining({
      remoteJid: 'user@s.whatsapp.net',
      presences: expect.any(Object)
    }))
  })

  it('should broadcast message-status-updated', async () => {
    const event: MessageStatusUpdatedEvent = {
      id: '1',
      chatJid: 'user@s.whatsapp.net',
      status: 3
    } as any
    await bus.emit('message:status-updated', event)
    expect(mockWebContents.send).toHaveBeenCalledWith('message-status-updated', event)
  })

  it('should broadcast new-message on reaction:processed', async () => {
    const event: ReactionProcessedEvent = {
      id: '1',
      chatJid: 'user@s.whatsapp.net',
      messageType: 'reactionMessage'
    } as any
    await bus.emit('reaction:processed', event)
    expect(mockWebContents.send).toHaveBeenCalledWith('new-message', event)
  })

  it('should gracefully handle null window', async () => {
    const getMainWindowNull = () => null
    const subNull = new UIBroadcastSubscriber(
      contactService, messageQueryService, messageQueryRepository, getMainWindowNull
    )
    const mockBus = new MockEventBus()
    subNull.register(mockBus)
    
    await mockBus.emit('message:incoming', { enriched: { id: '1' } } as any)
    expect(mockWebContents.send).not.toHaveBeenCalled()
  })
})
