import { MessagePort, Worker } from 'node:worker_threads'
import { IBidirectionalPluginChannel, KernelRequest, KernelResponse } from './IPluginChannel'
// eslint-disable-next-line no-restricted-imports -- specific file (logger.ts), not the utils barrel; the pattern over-matches
import { createLogger } from '../../utils/logger'

const log = createLogger('kernel:worker-channel')

/**
 * Ceiling for a kernel→plugin request. A plugin that never replies (crashed
 * mid-handler, threw asynchronously, infinite loop) would otherwise wedge the
 * caller forever and leak the pending entry. (S9-04)
 */
export const PLUGIN_REQUEST_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (res: KernelResponse) => void
  reject: (err: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

function isKernelRequest(msg: unknown): msg is KernelRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'id' in msg &&
    'type' in msg &&
    typeof (msg as KernelRequest).id === 'string' &&
    typeof (msg as KernelRequest).type === 'string'
  )
}

function isKernelResponse(msg: unknown): msg is KernelResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'id' in msg &&
    'ok' in msg &&
    typeof (msg as KernelResponse).id === 'string' &&
    typeof (msg as KernelResponse).ok === 'boolean'
  )
}

/** Cap on payload nesting — deeper than this is almost certainly a mistake and
 *  would risk a stack overflow before `postMessage` ever sees it. (P2-S9-05) */
const MAX_SERIALIZABLE_DEPTH = 100

function assertSerializable(
  val: unknown,
  path = 'payload',
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): void {
  if (val === null || val === undefined) return
  const type = typeof val
  if (type === 'function' || type === 'symbol') {
    throw new Error(`Non-serializable value of type '${type}' found at ${path}`)
  }
  if (type === 'object') {
    if (seen.has(val as object)) {
      throw new Error(`Circular reference in payload at ${path}`)
    }
    if (depth >= MAX_SERIALIZABLE_DEPTH) {
      throw new Error(`Payload nested deeper than ${MAX_SERIALIZABLE_DEPTH} levels at ${path}`)
    }
    seen.add(val as object)
    for (const key of Object.keys(val as object)) {
      assertSerializable((val as Record<string, unknown>)[key], `${path}.${key}`, seen, depth + 1)
    }
  }
}

export class WorkerPluginChannel implements IBidirectionalPluginChannel {
  private pluginRequestHandler: ((msg: KernelRequest) => Promise<void>) | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private isDestroyed = false
  /** Set when the worker died on its own (uncaught error / unexpected exit). (B-KRN-05) */
  private isClosed = false
  private closedHandlers: Array<(reason: Error) => void> = []
  private port: MessagePort | Worker
  private worker: Worker | null

  constructor(port: MessagePort | Worker, worker: Worker | null = null) {
    this.port = port
    this.worker = worker
    this.port.on('message', this.handlePortMessage)
    if (this.worker) {
      // Without an 'error' listener a worker crash only surfaces as the main
      // process' uncaughtException, and the plugin would stay "loaded" forever.
      this.worker.on('error', this.handleWorkerError)
      this.worker.on('exit', this.handleWorkerExit)
    }
  }

  private handleWorkerError = (err: Error): void => {
    this.markClosed(err instanceof Error ? err : new Error(String(err)))
  }

  private handleWorkerExit = (code: number): void => {
    this.markClosed(new Error(`Plugin worker exited unexpectedly (code ${code})`))
  }

  /** Worker died by itself: fail pending requests now and tell the host once. */
  private markClosed(cause: Error): void {
    if (this.isDestroyed || this.isClosed) return
    this.isClosed = true
    log.warn('plugin worker closed unexpectedly', cause.message)
    const err = new Error(`PLUGIN_CRASHED: ${cause.message}`)
    for (const [, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pendingRequests.clear()
    const handlers = this.closedHandlers
    this.closedHandlers = []
    for (const h of handlers) {
      try {
        h(err)
      } catch (e) {
        log.error('onClosed handler threw', e)
      }
    }
  }

  onClosed(handler: (reason: Error) => void): void {
    this.closedHandlers.push(handler)
  }

  private handlePortMessage = (msg: unknown): void => {
    if (this.isDestroyed) {
      return
    }

    if (isKernelResponse(msg)) {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        this.pendingRequests.delete(msg.id)
        if (pending.timer) clearTimeout(pending.timer)
        pending.resolve(msg)
      }
    } else if (isKernelRequest(msg)) {
      if (this.pluginRequestHandler) {
        void this.pluginRequestHandler(msg)
      }
    }
  }

  sendToPlugin(msg: KernelRequest): void {
    if (this.isDestroyed || this.isClosed) return
    assertSerializable(msg.payload)
    this.port.postMessage(msg)
  }

  sendResponseToPlugin(msg: KernelResponse): void {
    if (this.isDestroyed || this.isClosed) return
    assertSerializable(msg.payload)
    if (msg.error) {
      assertSerializable(msg.error, 'error')
    }
    this.port.postMessage(msg)
  }

  sendRequestToPlugin(msg: KernelRequest): Promise<KernelResponse> {
    if (this.isDestroyed || this.isClosed) {
      // Resolve a KernelResponse (not reject) so callers get the same failure
      // shape DirectPluginChannel gives them for a destroyed channel. (P2-S9-04)
      return Promise.resolve({
        id: msg.id,
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Channel destroyed' }
      })
    }
    assertSerializable(msg.payload)
    return new Promise<KernelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.delete(msg.id)) {
          reject(new Error(`PLUGIN_TIMEOUT: plugin did not respond to '${msg.type}' within ${PLUGIN_REQUEST_TIMEOUT_MS}ms`))
        }
      }, PLUGIN_REQUEST_TIMEOUT_MS)
      if (typeof timer.unref === 'function') timer.unref()
      this.pendingRequests.set(msg.id, { resolve, reject, timer })
      this.port.postMessage(msg)
    })
  }

  onPluginRequest(handler: (msg: KernelRequest) => Promise<void>): void {
    this.pluginRequestHandler = handler
  }

  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true

    for (const [, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new Error('Channel destroyed'))
    }
    this.pendingRequests.clear()

    this.pluginRequestHandler = null
    this.closedHandlers = []
    // Each step is isolated: a throwing close() must not skip terminate(), or
    // the worker thread leaks.
    try {
      if ('off' in this.port && typeof this.port.off === 'function') {
        this.port.off('message', this.handlePortMessage)
      }
      if (this.worker) {
        this.worker.off('error', this.handleWorkerError)
        this.worker.off('exit', this.handleWorkerExit)
        // Keep a no-op listener so a late startup error cannot become an unhandled 'error'.
        this.worker.on('error', () => undefined)
      }
    } catch (err) {
      log.warn('detaching listeners failed', err)
    }
    try {
      if ('close' in this.port && typeof this.port.close === 'function') {
        this.port.close()
      }
    } catch (err) {
      log.warn('port.close failed', err)
    }
    if (this.worker) {
      try {
        void Promise.resolve(this.worker.terminate()).catch(() => undefined)
      } catch (err) {
        log.warn('worker.terminate failed', err)
      }
    }
  }
}
