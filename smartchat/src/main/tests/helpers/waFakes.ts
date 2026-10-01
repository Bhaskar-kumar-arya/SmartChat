/**
 * waFakes — reusable, typed fakes for WhatsApp worker/main tests (N-02).
 *
 * Contents
 *  - FakeWorker / createWorkerThreadsModule(): stand-in for `worker_threads`
 *    (the bridge's `new Worker()` and the worker's `parentPort`).
 *  - FakeParentPort: the worker-side port; records `postMessage` calls.
 *  - createFakeBaileysSocket(): fake WASocket with a real-ish `ev` emitter.
 *  - createFakeEventPublisher(), createFakeWindowEmitter(), createFakeEventBus().
 *  - flushPromises().
 *
 * Usage (must be hoisted via vi.mock; the factory imports this module lazily):
 *
 *   vi.mock('worker_threads', async () =>
 *     (await import('../../helpers/waFakes')).createWorkerThreadsModule())
 *   import { FakeWorker, fakeParentPort } from '../../helpers/waFakes'
 */
import { EventEmitter } from 'events'
import { vi, type Mock } from 'vitest'
import type { WASocket } from '@whiskeysockets/baileys'
import type { IWAEventBus } from '../../services/whatsapp/IWAEventBus'
import type { WAEventMap } from '../../services/whatsapp/WAEventTypes'
import type { IWindowEventEmitter } from '../../workers/bridge/IWindowEventEmitter'
import type { IWorkerEventPublisher } from '../../workers/whatsapp/events/IWorkerEventPublisher'
import type {
  WorkerCommandMessage,
  WorkerEventMessage
} from '../../workers/whatsapp/whatsappWorker.types'

// ─── Worker side / main side ports ───────────────────────────────────────────

/** Fake of the main-thread `Worker` handle used by WAWorkerBridge. */
export class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = []

  readonly workerPath: unknown
  readonly postMessage: Mock<(msg: WorkerCommandMessage) => void> = vi.fn()
  readonly terminate: Mock<() => Promise<number>> = vi.fn(async () => 0)

  constructor(workerPath?: unknown) {
    super()
    this.workerPath = workerPath
    FakeWorker.instances.push(this)
  }

  static get last(): FakeWorker {
    const w = FakeWorker.instances[FakeWorker.instances.length - 1]
    if (!w) throw new Error('No FakeWorker has been constructed')
    return w
  }

  static reset(): void {
    FakeWorker.instances = []
  }

  /** Simulate a message arriving from the worker thread. */
  _emitMessage(msg: WorkerEventMessage | unknown): void {
    this.emit('message', msg)
  }

  _triggerError(err: Error): void {
    this.emit('error', err)
  }

  _triggerExit(code: number): void {
    this.emit('exit', code)
  }

  /** Commands the bridge posted to the worker, in order. */
  get commands(): WorkerCommandMessage[] {
    return this.postMessage.mock.calls.map((c) => c[0])
  }

  /** Last command of `type` posted by the bridge (throws if none). */
  commandOfType<T extends WorkerCommandMessage['type']>(
    type: T
  ): Extract<WorkerCommandMessage, { type: T }> {
    const found = [...this.commands].reverse().find((c) => c.type === type)
    if (!found) throw new Error(`No "${type}" command was posted`)
    return found as Extract<WorkerCommandMessage, { type: T }>
  }

  /** Reply to a previously posted command, as the worker would. */
  reply(correlationId: string, result: unknown): void {
    this._emitMessage({ type: 'reply', correlationId, payload: { result } })
  }

  replyError(correlationId: string, error: string): void {
    this._emitMessage({ type: 'reply_error', correlationId, error })
  }

  domainEvent(event: string, data?: unknown): void {
    this._emitMessage({ type: 'domain_event', payload: { event, data } })
  }
}

/** Fake of the worker-side `parentPort`. */
export class FakeParentPort {
  readonly postMessage: Mock<(msg: WorkerEventMessage) => void> = vi.fn()
  private handlers: Array<(msg: unknown) => void> = []

  on(event: string, handler: (msg: unknown) => void): this {
    if (event === 'message') this.handlers.push(handler)
    return this
  }

  /** Simulate the main thread sending a command to the worker. */
  _emitMessage(msg: unknown): void {
    for (const h of this.handlers) h(msg)
  }

  get posted(): WorkerEventMessage[] {
    return this.postMessage.mock.calls.map((c) => c[0])
  }

  get lastPosted(): WorkerEventMessage | undefined {
    return this.posted[this.posted.length - 1]
  }

  reset(): void {
    this.postMessage.mockClear()
    this.handlers = []
  }
}

export const fakeParentPort = new FakeParentPort()

/** Module factory for `vi.mock('worker_threads', ...)`. */
export function createWorkerThreadsModule(): {
  Worker: typeof FakeWorker
  parentPort: FakeParentPort
} {
  return { Worker: FakeWorker, parentPort: fakeParentPort }
}

// ─── Baileys socket ──────────────────────────────────────────────────────────

type EventsPayload = Record<string, unknown>
type ProcessHandler = (events: EventsPayload) => void | Promise<void>

/** Minimal Baileys `ev`: `process` batches handlers; `on`/`emit` per event. */
export class FakeBaileysEv {
  private readonly emitter = new EventEmitter()
  private processHandlers: ProcessHandler[] = []

  readonly process = vi.fn((handler: ProcessHandler) => {
    this.processHandlers.push(handler)
    return () => {
      this.processHandlers = this.processHandlers.filter((h) => h !== handler)
    }
  })

  on(event: string, listener: (data: unknown) => void): void {
    this.emitter.on(event, listener)
  }

  off(event: string, listener: (data: unknown) => void): void {
    this.emitter.off(event, listener)
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners()
    this.processHandlers = []
  }

  /** Emit one Baileys event: reaches `on` listeners and `process` handlers. */
  async emit(event: string, data: unknown): Promise<void> {
    this.emitter.emit(event, data)
    for (const h of this.processHandlers) await h({ [event]: data })
  }

  /** Emit several events in one `process` batch (as Baileys' buffer does). */
  async emitBatch(events: EventsPayload): Promise<void> {
    for (const [k, v] of Object.entries(events)) this.emitter.emit(k, v)
    for (const h of this.processHandlers) await h(events)
  }

  get processHandlerCount(): number {
    return this.processHandlers.length
  }
}

export interface FakeBaileysSocket {
  ev: FakeBaileysEv
  user: { id: string; name?: string; lid?: string } | undefined
  sendMessage: Mock<(...args: unknown[]) => Promise<unknown>>
  readMessages: Mock<(...args: unknown[]) => Promise<void>>
  chatModify: Mock<(...args: unknown[]) => Promise<void>>
  groupFetchAllParticipating: Mock<() => Promise<Record<string, unknown>>>
  groupMetadata: Mock<(jid: string) => Promise<unknown>>
  profilePictureUrl: Mock<(jid: string, type?: string) => Promise<string | undefined>>
  /** Raw iq query; the router's profile_picture_url sends its own iq through this. */
  query: Mock<(node: unknown, timeoutMs?: number) => Promise<unknown>>
  updateMediaMessage: Mock<(msg: unknown) => Promise<unknown>>
  fetchMessageHistory: Mock<(...args: unknown[]) => Promise<string>>
  logout: Mock<() => Promise<void>>
  signalRepository: {
    lidMapping: { getPNForLID: Mock<(lid: string) => Promise<string | null | undefined>> }
  }
  end: Mock<(err?: Error) => void>
}

export function createFakeBaileysSocket(): FakeBaileysSocket & WASocket {
  const fake: FakeBaileysSocket = {
    ev: new FakeBaileysEv(),
    user: { id: '1111@s.whatsapp.net', name: 'Me' },
    sendMessage: vi.fn(async () => ({ key: { id: 'sent-1' } })),
    readMessages: vi.fn(async () => undefined),
    chatModify: vi.fn(async () => undefined),
    groupFetchAllParticipating: vi.fn(async () => ({})),
    groupMetadata: vi.fn(async (jid: string) => ({ id: jid, subject: 'Group', participants: [] })),
    profilePictureUrl: vi.fn(async () => 'https://pp.example/img.jpg'),
    query: vi.fn(async () => ({
      tag: 'iq',
      attrs: {},
      content: [{ tag: 'picture', attrs: { url: 'https://pp.example/img.jpg' } }]
    })),
    updateMediaMessage: vi.fn(async (msg: unknown) => msg),
    fetchMessageHistory: vi.fn(async () => 'req-1'),
    logout: vi.fn(async () => undefined),
    signalRepository: { lidMapping: { getPNForLID: vi.fn(async () => '2222@s.whatsapp.net') } },
    end: vi.fn()
  }
  return fake as unknown as FakeBaileysSocket & WASocket
}

// ─── Publishers / emitters / bus ─────────────────────────────────────────────

export interface FakeEventPublisher extends IWorkerEventPublisher {
  publish: Mock<(event: string, data?: unknown) => void>
  /** [event, data] tuples in publish order. */
  readonly events: Array<[string, unknown]>
}

export function createFakeEventPublisher(): FakeEventPublisher {
  const publish = vi.fn<(event: string, data?: unknown) => void>()
  return {
    publish,
    get events(): Array<[string, unknown]> {
      return publish.mock.calls.map((c) => [c[0], c[1]] as [string, unknown])
    }
  }
}

export interface FakeWindowEmitter extends IWindowEventEmitter {
  send: Mock<(channel: string, data?: unknown) => void>
}

export function createFakeWindowEmitter(): FakeWindowEmitter {
  return { send: vi.fn() }
}

export interface FakeEventBus extends IWAEventBus {
  emit: Mock<(event: keyof WAEventMap, data: unknown) => Promise<void>>
}

export function createFakeEventBus(): FakeEventBus {
  const bus = {
    emit: vi.fn(async () => undefined),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn()
  }
  bus.on.mockReturnValue(bus)
  bus.off.mockReturnValue(bus)
  return bus as unknown as FakeEventBus
}

/** Let queued microtasks and immediate callbacks settle. */
export async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}
