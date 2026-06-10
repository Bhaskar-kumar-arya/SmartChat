/**
 * IWAEventSubscriber
 * ==================
 * Contract that every WA event subscriber must implement.
 *
 * - `register(bus)` — called once on socket connect; subscribe to events here.
 * - `dispose()`    — called on socket teardown; unsubscribe / clean up here.
 */

import type { WAEventBus } from '../WAEventBus'

export interface IWAEventSubscriber {
  /**
   * Subscribe to the relevant events on the bus.
   * Called each time a new socket is created (i.e. on connect/reconnect).
   */
  register(bus: WAEventBus): void

  /**
   * Unsubscribe all handlers and release any held resources.
   * Called when the socket is torn down.
   */
  dispose(): void
}
