import type { WAEventMap } from './WAEventTypes'

export type AsyncHandler<T> = (data: T) => Promise<void> | void

export interface IWAEventBus {
  /**
   * Register a handler for a typed event.
   */
  on<K extends keyof WAEventMap>(
    event: K,
    handler: AsyncHandler<WAEventMap[K]>
  ): this

  /**
   * Remove a specific handler for a typed event.
   */
  off<K extends keyof WAEventMap>(
    event: K,
    handler: AsyncHandler<WAEventMap[K]>
  ): this

  /**
   * Emit a typed event and await all registered handlers sequentially.
   */
  emit<K extends keyof WAEventMap>(
    event: K,
    data: WAEventMap[K]
  ): Promise<void>

  /**
   * Remove all listeners.
   */
  removeAllListeners(): void
}
