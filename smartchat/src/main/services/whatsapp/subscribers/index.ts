/**
 * subscribers/index.ts
 * ====================
 * Factory that creates and registers all WA event subscribers onto the bus.
 *
 * To add a new subscriber (e.g. AIEventSubscriber):
 *   1. Create your subscriber class implementing IWAEventSubscriber.
 *   2. Import it here and add one line to the array below.
 *   3. Done — no other files need to change.
 */

import { BrowserWindow } from 'electron'
import type { IWAEventBus } from '../IWAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'

import { NotificationSubscriber }  from './NotificationSubscriber'
import { UIBroadcastSubscriber }   from './UIBroadcastSubscriber'
import { PersistenceSubscriber }   from './PersistenceSubscriber'
import { ContactGroupSubscriber }  from './ContactGroupSubscriber'
import { ReceiptSubscriber }       from './ReceiptSubscriber'
import { FavoriteStickerSubscriber } from './FavoriteStickerSubscriber'

import type { MessageService } from '../../messages/MessageService'
import type { ChatService } from '../../chats/ChatService'
import type { ContactService } from '../../contacts/ContactService'
import type { IChatMemberRepository } from '../../chats/IChatMemberRepository'
import type { ProfileSyncService } from '../../contacts/ProfileSyncService'
import type { NotificationService } from '../../notification/NotificationService'
import type { IMessageQueryRepository } from '../../messages/IMessageQueryRepository'
import type { ReceiptService } from '../ReceiptService'
import type { FavoriteStickerService } from '../../messages/FavoriteStickerService'

export type { IWAEventSubscriber }

export interface SubscriberServices {
  messageService: MessageService
  chatService: ChatService
  contactService: ContactService
  chatMemberRepository: IChatMemberRepository
  profileSyncService: ProfileSyncService
  notificationService: NotificationService
  messageQueryRepository: IMessageQueryRepository
  receiptService: ReceiptService
  favoriteStickerService: FavoriteStickerService
}

/**
 * Creates all subscribers, registers them on the bus, and returns the list.
 * Call `subscribers.forEach(s => s.dispose())` when the socket is torn down,
 * or simply call `bus.removeAllListeners()` for a full reset on reconnect.
 */
export function createSubscribers(
  bus: IWAEventBus,
  services: SubscriberServices,
  getMainWindow: () => BrowserWindow | null
): IWAEventSubscriber[] {
  const subscribers: IWAEventSubscriber[] = [
    new PersistenceSubscriber(services.messageService, services.chatService),
    new ContactGroupSubscriber(services.contactService, services.chatService, services.chatMemberRepository),
    new NotificationSubscriber(services.chatService, services.contactService, services.profileSyncService, services.notificationService),
    new UIBroadcastSubscriber(services.contactService, services.messageService, services.messageQueryRepository, getMainWindow),
    new ReceiptSubscriber(services.receiptService, services.messageService, services.contactService),
    new FavoriteStickerSubscriber(services.favoriteStickerService),
  ]

  // Register each subscriber on the bus — order matters for same-event handlers
  // (PersistenceSubscriber registers before UIBroadcastSubscriber so DB writes
  //  land before IPC sends, matching the old behaviour)
  subscribers.forEach(s => s.register(bus))

  return subscribers
}
