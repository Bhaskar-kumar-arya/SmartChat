import { MessagePort, Worker } from 'node:worker_threads'
import { IBidirectionalPluginChannel, KernelRequest, KernelResponse } from './IPluginChannel'

interface PendingRequest {
  resolve: (res: KernelResponse) => void
  reject: (err: Error) => void
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

function assertSerializable(val: unknown, path = 'payload'): void {
  if (val === null || val === undefined) return
  const type = typeof val
  if (type === 'function' || type === 'symbol') {
    throw new Error(`Non-serializable value of type '${type}' found at ${path}`)
  }
  if (type === 'object') {
    for (const key of Object.keys(val as object)) {
      assertSerializable((val as Record<string, unknown>)[key], `${path}.${key}`)
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
      return Promise.reject(new Error('Channel destroyed'))
    }
    assertSerializable(msg.payload)
    return new Promise<KernelResponse>((resolve, reject) => {
      this.pendingRequests.set(msg.id, { resolve, reject })
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
