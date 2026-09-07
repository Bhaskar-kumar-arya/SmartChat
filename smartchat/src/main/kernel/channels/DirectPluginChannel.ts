import { IBidirectionalPluginChannel, KernelRequest, KernelResponse } from './IPluginChannel'

/** Ceiling for a kernel→plugin request; see WorkerPluginChannel. (S9-04) */
export const PLUGIN_REQUEST_TIMEOUT_MS = 30_000

interface PendingEntry {
  resolve: (res: KernelResponse) => void
  reject: (err: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export class DirectPluginChannel implements IBidirectionalPluginChannel {
  private pluginRequestHandler: ((msg: KernelRequest) => Promise<void>) | null = null
  private kernelRequestHandler: ((msg: KernelRequest) => Promise<void>) | null = null
  private kernelResponseHandler: ((msg: KernelResponse) => void) | null = null
  private pendingRequests = new Map<string, PendingEntry>()
  private isDestroyed = false

  private settlePending(id: string): PendingEntry | undefined {
    const pending = this.pendingRequests.get(id)
    if (pending) {
      this.pendingRequests.delete(id)
      if (pending.timer) clearTimeout(pending.timer)
    }
    return pending
  }

  sendToPlugin(msg: KernelRequest): void {
    if (this.isDestroyed) return
    if (this.kernelRequestHandler) {
      void this.kernelRequestHandler(msg)
    }
  }

  sendResponseToPlugin(msg: KernelResponse): void {
    if (this.isDestroyed) return
    const pending = this.settlePending(msg.id)
    if (pending) {
      pending.resolve(msg)
    }
    if (this.kernelResponseHandler) {
      this.kernelResponseHandler(msg)
    }
  }

  async sendRequestToPlugin(msg: KernelRequest): Promise<KernelResponse> {
    if (this.isDestroyed) {
      return { id: msg.id, ok: false, error: { code: 'INTERNAL_ERROR', message: 'Channel destroyed' } }
    }
    return new Promise<KernelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.settlePending(msg.id)) {
          reject(new Error(`PLUGIN_TIMEOUT: plugin did not respond to '${msg.type}' within ${PLUGIN_REQUEST_TIMEOUT_MS}ms`))
        }
      }, PLUGIN_REQUEST_TIMEOUT_MS)
      if (typeof timer.unref === 'function') timer.unref()
      this.pendingRequests.set(msg.id, { resolve, reject, timer })
      if (this.kernelRequestHandler) {
        this.kernelRequestHandler(msg).catch((err) => {
          if (this.settlePending(msg.id)) reject(err)
        })
      } else {
        this.settlePending(msg.id)
        resolve({
          id: msg.id,
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'No kernel request handler attached' }
        })
      }
    })
  }

  onPluginRequest(handler: (msg: KernelRequest) => Promise<void>): void {
    this.pluginRequestHandler = handler
  }

  destroy(): void {
    this.isDestroyed = true
    for (const pending of this.pendingRequests.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new Error('Channel destroyed'))
    }
    this.pendingRequests.clear()
    this.pluginRequestHandler = null
    this.kernelRequestHandler = null
    this.kernelResponseHandler = null
  }

  // Plugin-side helpers for in-process/built-in communication & testing
  async sendFromPlugin(msg: KernelRequest): Promise<void> {
    if (this.isDestroyed) return
    if (this.pluginRequestHandler) {
      await this.pluginRequestHandler(msg)
    }
  }

  async requestFromPlugin(msg: KernelRequest): Promise<KernelResponse> {
    if (this.isDestroyed) {
      return { id: msg.id, ok: false, error: { code: 'INTERNAL_ERROR', message: 'Channel destroyed' } }
    }
    return new Promise<KernelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.settlePending(msg.id)) {
          reject(new Error(`PLUGIN_TIMEOUT: no response to '${msg.type}' within ${PLUGIN_REQUEST_TIMEOUT_MS}ms`))
        }
      }, PLUGIN_REQUEST_TIMEOUT_MS)
      if (typeof timer.unref === 'function') timer.unref()
      this.pendingRequests.set(msg.id, { resolve, reject, timer })
      if (this.pluginRequestHandler) {
        this.pluginRequestHandler(msg).catch((err) => {
          if (this.settlePending(msg.id)) reject(err)
        })
      } else {
        this.settlePending(msg.id)
        resolve({
          id: msg.id,
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'No plugin request handler attached' }
        })
      }
    })
  }

  onKernelRequest(handler: (msg: KernelRequest) => Promise<void>): void {
    this.kernelRequestHandler = handler
  }

  onKernelResponse(handler: (msg: KernelResponse) => void): void {
    this.kernelResponseHandler = handler
  }
}
