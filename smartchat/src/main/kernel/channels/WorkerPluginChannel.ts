import { MessagePort, Worker } from 'node:worker_threads'
import { IBidirectionalPluginChannel, KernelRequest, KernelResponse } from './IPluginChannel'

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
  private port: MessagePort | Worker
  private worker: Worker | null

  constructor(port: MessagePort | Worker, worker: Worker | null = null) {
    this.port = port
    this.worker = worker
    this.port.on('message', this.handlePortMessage)
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
    if (this.isDestroyed) return
    assertSerializable(msg.payload)
    this.port.postMessage(msg)
  }

  sendResponseToPlugin(msg: KernelResponse): void {
    if (this.isDestroyed) return
    assertSerializable(msg.payload)
    if (msg.error) {
      assertSerializable(msg.error, 'error')
    }
    this.port.postMessage(msg)
  }

  sendRequestToPlugin(msg: KernelRequest): Promise<KernelResponse> {
    if (this.isDestroyed) {
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
    if ('off' in this.port && typeof this.port.off === 'function') {
      this.port.off('message', this.handlePortMessage)
    }
    if ('close' in this.port && typeof this.port.close === 'function') {
      this.port.close()
    }
    if (this.worker) {
      void this.worker.terminate()
    }
  }
}
