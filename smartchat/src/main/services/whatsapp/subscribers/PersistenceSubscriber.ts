/**
 * PersistenceSubscriber
 * =====================
 * Listens to domain events and handles all database write operations:
 * - Bulk-persist backlog messages (append)
 * - Increment unread / update chat timestamp for incoming messages
 * - Mark messages as deleted or edited in the DB
 * - Upsert chat records
 *
 * Single responsibility: database writes only. No IPC, no notifications.
 */


import type { IWAEventBus } from '../IWAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type {
  IncomingMessageEvent,
  AppendMessagesEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  ChatUpdatedEvent,
  ChatUpsertedEvent,
  MessageDecryptedEvent
} from '../WAEventTypes'
import type { IMessageWriterService } from '../../messages/IMessageWriterService'
import type { IChatService } from '../../chats/IChatService'

export class PersistenceSubscriber implements IWAEventSubscriber {
  constructor(
    private messageWriterService: IMessageWriterService,
    private chatService: IChatService
  ) {}

  register(bus: IWAEventBus): void {
    bus.on('messages:append',  this.onAppend.bind(this))
    bus.on('message:incoming', this.onIncoming.bind(this))
    bus.on('message:deleted',  this.onDeleted.bind(this))
    bus.on('message:edited',   this.onEdited.bind(this))
    bus.on('message:decrypted', this.onDecrypted.bind(this))
    bus.on('chat:updated',     this.onChatUpdated.bind(this))
    bus.on('chat:upserted',    this.onChatUpserted.bind(this))
  }

  dispose(): void {
    // Bus teardown handles listener removal
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private async onAppend(event: AppendMessagesEvent): Promise<void> {
    try {
      await this.messageWriterService.bulkPersistMessages(event.messages)
    } catch (err) {
      console.error('[PersistenceSubscriber] Bulk persist error:', err)
    }
  }

  private async onIncoming(event: IncomingMessageEvent): Promise<void> {
    const { chatJid, messageType, fromMe, timestamp } = event
    try {
      if (messageType !== 'reactionMessage') {
        if (!fromMe && messageType !== 'system') {
          await this.chatService.incrementUnread(chatJid, timestamp)
        } else {
          await this.chatService.updateTimestamp(chatJid, timestamp)
        }
      }
    } catch (err) {
      console.error('[PersistenceSubscriber] Error updating chat for incoming message:', err)
    }
  }

  private async onChatUpdated(event: ChatUpdatedEvent): Promise<void> {
    try {
      await this.chatService.upsertChat(event.jid, event.update).catch((err) => {
        console.error('[PersistenceSubscriber] Failed to upsert chat in onChatUpdated:', err)
      })
    } catch (err) {
      console.error('[PersistenceSubscriber] Error upserting chat from update:', err)
    }
  }

  private async onChatUpserted(event: ChatUpsertedEvent): Promise<void> {
    try {
      await this.chatService.upsertChat(event.jid, event.raw).catch((err) => {
        console.error('[PersistenceSubscriber] Failed to upsert chat in onChatUpserted:', err)
      })
    } catch (err) {
      console.error('[PersistenceSubscriber] Error upserting chat:', err)
    }
  }

  private async onDeleted(event: MessageDeletedEvent): Promise<void> {
    try {
      await this.messageWriterService.revokeMessageInDb(event.messageId)
    } catch (err) {
      console.error('[PersistenceSubscriber] Error updating DB for deleted message:', err)
    }
  }

  private async onEdited(event: MessageEditedEvent): Promise<void> {
    try {
      await this.messageWriterService.editMessageInDb(
        event.messageId,
        event.editedTextContent,
        event.editedContent as unknown as Record<string, unknown> | null
      )
    } catch (err) {
      console.error('[PersistenceSubscriber] Error updating DB for edited message:', err)
    }
  }

  private async onDecrypted(event: MessageDecryptedEvent): Promise<void> {
    try {
      await this.messageWriterService.decryptMessageInDb(
        event.messageId,
        event.messageType,
        event.textContent,
        event.content
      )
    } catch (err) {
      console.error('[PersistenceSubscriber] Error updating DB for decrypted message:', err)
    }
  }
}
