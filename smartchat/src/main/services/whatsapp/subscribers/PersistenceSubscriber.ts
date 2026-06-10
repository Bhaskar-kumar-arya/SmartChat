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
    // NOTE: message:deleted and message:edited are NOT handled here.
    // MessageService.processMessage() already performs the DB write for protocol
    // messages (revoke/edit) before WAEventHandler emits these domain events.
    // PersistenceSubscriber adding a second write would be a duplicate.
    // UIBroadcastSubscriber handles these events to push UI updates.
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
}
