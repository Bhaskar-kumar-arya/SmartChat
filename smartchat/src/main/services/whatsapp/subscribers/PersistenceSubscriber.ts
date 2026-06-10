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


import type { WAEventBus } from '../WAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type {
  IncomingMessageEvent,
  AppendMessagesEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  ChatUpdatedEvent,
  ChatUpsertedEvent,
} from '../WAEventTypes'
import type { ServiceContainer } from '../../../ServiceContainer'

export class PersistenceSubscriber implements IWAEventSubscriber {
  constructor(
    private services: ServiceContainer
  ) {}

  register(bus: WAEventBus): void {
    bus.on('messages:append',  this.onAppend.bind(this))
    bus.on('message:incoming', this.onIncoming.bind(this))
    bus.on('message:deleted',  this.onDeleted.bind(this))
    bus.on('message:edited',   this.onEdited.bind(this))
    bus.on('chat:updated',     this.onChatUpdated.bind(this))
    bus.on('chat:upserted',    this.onChatUpserted.bind(this))
  }

  dispose(): void {
    // Bus teardown handles listener removal
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private async onAppend(event: AppendMessagesEvent): Promise<void> {
    try {
      await this.services.messageService.bulkPersistMessages(event.messages)
    } catch (err) {
      console.error('[PersistenceSubscriber] Bulk persist error:', err)
    }
  }

  private async onIncoming(event: IncomingMessageEvent): Promise<void> {
    const { chatJid, messageType, fromMe, timestamp } = event
    try {
      if (!fromMe) {
        if (messageType !== 'reactionMessage') {
          await this.services.chatService.incrementUnread(chatJid, timestamp)
        }
      } else if (messageType !== 'reactionMessage') {
        await this.services.chatService.updateTimestamp(chatJid, timestamp)
      }
    } catch (err) {
      console.error('[PersistenceSubscriber] Error updating chat for incoming message:', err)
    }
  }

  private async onChatUpdated(event: ChatUpdatedEvent): Promise<void> {
    try {
      await this.services.chatService.upsertChat(event.jid, event.update).catch(() => {})
    } catch (err) {
      console.error('[PersistenceSubscriber] Error upserting chat from update:', err)
    }
  }

  private async onChatUpserted(event: ChatUpsertedEvent): Promise<void> {
    try {
      await this.services.chatService.upsertChat(event.jid, event.raw).catch(() => {})
    } catch (err) {
      console.error('[PersistenceSubscriber] Error upserting chat:', err)
    }
  }

  private async onDeleted(event: MessageDeletedEvent): Promise<void> {
    try {
      await this.services.messageService.revokeMessageInDb(event.messageId)
    } catch (err) {
      console.error('[PersistenceSubscriber] Error updating DB for deleted message:', err)
    }
  }

  private async onEdited(event: MessageEditedEvent): Promise<void> {
    try {
      await this.services.messageService.editMessageInDb(
        event.messageId,
        event.editedTextContent,
        event.editedContent
      )
    } catch (err) {
      console.error('[PersistenceSubscriber] Error updating DB for edited message:', err)
    }
  }
}
