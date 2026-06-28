import { IWAEventBus, AsyncHandler } from '../../../services/whatsapp/IWAEventBus'
import { WAEventMap } from '../../../services/whatsapp/WAEventTypes'
import { IWorkerEventPublisher } from './IWorkerEventPublisher'
import { sanitizeForPostMessage } from '../utils/workerUtils'

/**
 * WorkerEventBusAdapter
 * ====================
 * Intercepts calls to emit() and routes them to the main process via IWorkerEventPublisher
 * (composition instead of monkey-patching).
 */
export class WorkerEventBusAdapter implements IWAEventBus {
  constructor(
    private readonly wrapped: IWAEventBus,
    private readonly eventPublisher: IWorkerEventPublisher
  ) {}

  public on<K extends keyof WAEventMap>(
    event: K,
    handler: AsyncHandler<WAEventMap[K]>
  ): this {
    this.wrapped.on(event, handler)
    return this
  }

  public off<K extends keyof WAEventMap>(
    event: K,
    handler: AsyncHandler<WAEventMap[K]>
  ): this {
    this.wrapped.off(event, handler)
    return this
  }

  public async emit<K extends keyof WAEventMap>(
    event: K,
    data: WAEventMap[K]
  ): Promise<void> {
    if ((event as string) !== 'app-state:sync') {
      let safeData = data
      if (data && typeof data === 'object') {
        const dataObj = data as unknown as Record<string, unknown>
        if ('sock' in dataObj) {
          const { sock: _, ...rest } = dataObj
          safeData = rest as unknown as typeof data
        }
      }
      this.eventPublisher.publish(event as string, sanitizeForPostMessage(safeData))
    }
    await this.wrapped.emit(event, data)
  }

  public removeAllListeners(): void {
    this.wrapped.removeAllListeners()
  }
}
