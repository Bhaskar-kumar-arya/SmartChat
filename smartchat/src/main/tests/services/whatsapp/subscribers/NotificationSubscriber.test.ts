import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { NotificationSubscriber } from '../../../../services/whatsapp/subscribers/NotificationSubscriber'
import type { IChatService } from '../../../../services/chats/IChatService'
import type { IContactNameResolver } from '../../../../services/contacts/IContactService'
import type { IProfileSyncService } from '../../../../services/contacts/IProfileSyncService'
import type { INotificationService } from '../../../../services/notification/INotificationService'
import type { IWAEventBus, AsyncHandler } from '../../../../services/whatsapp/IWAEventBus'
import type { IncomingMessageEvent } from '../../../../services/whatsapp/WAEventTypes'

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

describe('NotificationSubscriber', () => {
  let chatService: Mocked<IChatService>
  let contactService: Mocked<IContactNameResolver>
  let profileSyncService: Mocked<IProfileSyncService>
  let notificationService: Mocked<INotificationService>
  let bus: MockEventBus
  let subscriber: NotificationSubscriber

  beforeEach(() => {
    chatService = {
      isChatMuted: vi.fn().mockResolvedValue(false),
      upsertChat: vi.fn(),
      updateTimestamp: vi.fn(),
      incrementUnread: vi.fn(),
      deleteChat: vi.fn(),
      toggleMute: vi.fn(),
      toggleArchive: vi.fn(),
      togglePin: vi.fn(),
    } as any

    contactService = {
      batchResolveNames: vi.fn().mockResolvedValue(new Map([['user@s.whatsapp.net', 'Test User']])),
    } as any

    profileSyncService = {
      getProfilePicture: vi.fn().mockResolvedValue('http://pic.jpg'),
      syncProfilePicture: vi.fn(),
      syncProfileAbout: vi.fn(),
    } as any

    notificationService = {
      notify: vi.fn()
    } as any

    bus = new MockEventBus()
    subscriber = new NotificationSubscriber(chatService, contactService, profileSyncService, notificationService)
    subscriber.register(bus)
  })

  it('should ignore fromMe messages', async () => {
    const event: IncomingMessageEvent = {
      sock: {} as any,
      messageId: '1',
      chatJid: 'user@s.whatsapp.net',
      senderJid: 'me@s.whatsapp.net',
      messageType: 'conversation',
      fromMe: true,
      timestamp: 1000n,
      enriched: {} as any
    } as any
    await bus.emit('message:incoming', event)
    expect(notificationService.notify).not.toHaveBeenCalled()
  })

  it('should ignore reactionMessage messages', async () => {
    const event: IncomingMessageEvent = {
      sock: {} as any,
      messageId: '2',
      chatJid: 'user@s.whatsapp.net',
      senderJid: 'user@s.whatsapp.net',
      messageType: 'reactionMessage',
      fromMe: false,
      timestamp: 1000n,
      enriched: {} as any
    } as any
    await bus.emit('message:incoming', event)
    expect(notificationService.notify).not.toHaveBeenCalled()
  })

  it('should ignore muted chats', async () => {
    chatService.isChatMuted.mockResolvedValue(true)
    const event: IncomingMessageEvent = {
      sock: {} as any,
      messageId: '3',
      chatJid: 'user@s.whatsapp.net',
      senderJid: 'user@s.whatsapp.net',
      messageType: 'conversation',
      fromMe: false,
      timestamp: 1000n,
      enriched: {} as any
    } as any
    await bus.emit('message:incoming', event)
    expect(notificationService.notify).not.toHaveBeenCalled()
  })

  it('should send notification for valid incoming message', async () => {
    const event: IncomingMessageEvent = {
      sock: {} as any,
      messageId: '4',
      chatJid: 'user@s.whatsapp.net',
      senderJid: 'user@s.whatsapp.net',
      messageType: 'conversation',
      textContent: 'Hello',
      fromMe: false,
      timestamp: 1000n,
      enriched: { participantName: 'Test Sender' } as any
    } as any
    await bus.emit('message:incoming', event)
    expect(notificationService.notify).toHaveBeenCalledWith({
      chatJid: 'user@s.whatsapp.net',
      chatName: 'Test User',
      senderName: 'Test Sender',
      messageType: 'conversation',
      textContent: 'Hello',
      profilePicUrl: 'http://pic.jpg',
      content: undefined
    })
  })
})
