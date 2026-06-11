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
import { PrismaClient } from '@prisma/client'
import type { WAEventBus } from '../WAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type { ServiceContainer } from '../../../ServiceContainer'

import { NotificationSubscriber }  from './NotificationSubscriber'
import { UIBroadcastSubscriber }   from './UIBroadcastSubscriber'
import { PersistenceSubscriber }   from './PersistenceSubscriber'
import { ContactGroupSubscriber }  from './ContactGroupSubscriber'
import { ReceiptSubscriber }       from './ReceiptSubscriber'
import { FavoriteStickerSubscriber } from './FavoriteStickerSubscriber'

export type { IWAEventSubscriber }

/**
 * Creates all subscribers, registers them on the bus, and returns the list.
 * Call `subscribers.forEach(s => s.dispose())` when the socket is torn down,
 * or simply call `bus.removeAllListeners()` for a full reset on reconnect.
 */
export function createSubscribers(
  bus: WAEventBus,
  services: ServiceContainer,
  getMainWindow: () => BrowserWindow | null,
  prisma: PrismaClient
): IWAEventSubscriber[] {
  const subscribers: IWAEventSubscriber[] = [
    new PersistenceSubscriber(services),
    new ContactGroupSubscriber(services, prisma),
    new NotificationSubscriber(services),
    new UIBroadcastSubscriber(services, getMainWindow, prisma),
    new ReceiptSubscriber(services, getMainWindow),
    new FavoriteStickerSubscriber(services),
  ]

  // Register each subscriber on the bus — order matters for same-event handlers
  // (PersistenceSubscriber registers before UIBroadcastSubscriber so DB writes
  //  land before IPC sends, matching the old behaviour)
  subscribers.forEach(s => s.register(bus))

  return subscribers
}
