/**
 * WAEventBus
 * ==========
 * A lightweight, type-safe synchronous event bus built on Node's EventEmitter.
 *
 * Key design decisions:
 * - **Synchronous execution**: handlers run in registration order, each awaited.
 *   This preserves the ordering guarantee from the old WAEventHandler (DB writes
 *   always complete before IPC sends for the same event batch).
 * - **No external dependencies**: uses Node's built-in EventEmitter.
 * - **Full TypeScript type safety**: the WAEventMap ensures emit() and on()
 *   calls are always correctly typed — no string guessing.
 */

import { EventEmitter } from 'events'
import type { WAEventMap } from './WAEventTypes'
import type { IWAEventBus, AsyncHandler } from './IWAEventBus'

export class WAEventBus implements IWAEventBus {
  private emitter = new EventEmitter()

  constructor() {
    // Increase limit since we have ~5 subscribers × ~8 events each
    this.emitter.setMaxListeners(50)
  }

  /**
   * Register a handler for a typed event.
   */
  on<K extends keyof WAEventMap>(
    event: K,
    handler: AsyncHandler<WAEventMap[K]>
  ): this {
    this.emitter.on(event as string, handler)
    return this
  }

  /**
   * Remove a specific handler for a typed event.
   */
  off<K extends keyof WAEventMap>(
    event: K,
    handler: AsyncHandler<WAEventMap[K]>
  ): this {
    this.emitter.off(event as string, handler)
    return this
  }

  /**
   * Emit a typed event and **await all registered handlers sequentially**.
   *
   * Sequential execution preserves the ordering guarantee: if PersistenceSubscriber
   * and UIBroadcastSubscriber both listen to 'message:incoming', the DB write
   * completes before the IPC send — matching the old behaviour exactly.
   */
  async emit<K extends keyof WAEventMap>(
    event: K,
    data: WAEventMap[K]
  ): Promise<void> {
    const handlers = this.emitter.rawListeners(event as string) as AsyncHandler<WAEventMap[K]>[]
    for (const handler of handlers) {
      try {
        await handler(data)
      } catch (err) {
        console.error(`[WAEventBus] Unhandled error in handler for "${String(event)}":`, err)
      }
    }
  }

  /**
   * Remove all listeners — call this when the socket is torn down
   * to prevent memory leaks across reconnects.
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners()
  }
}
