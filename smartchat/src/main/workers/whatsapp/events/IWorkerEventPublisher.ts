/**
 * Interface abstracting event publishing inside workers.
 */
export interface IWorkerEventPublisher {
  publish(event: string, data?: unknown): void
}
