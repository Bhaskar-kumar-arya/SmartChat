import { IBidirectionalPluginChannel, KernelRequest, KernelResponse } from './IPluginChannel'

export class DirectPluginChannel implements IBidirectionalPluginChannel {
  private pluginRequestHandler: ((msg: KernelRequest) => Promise<void>) | null = null
  private kernelRequestHandler: ((msg: KernelRequest) => Promise<void>) | null = null
  private kernelResponseHandler: ((msg: KernelResponse) => void) | null = null
  private pendingRequests = new Map<string, { resolve: (res: KernelResponse) => void; reject: (err: Error) => void }>()
  private isDestroyed = false

  sendToPlugin(msg: KernelRequest): void {
    if (this.isDestroyed) return
    if (this.kernelRequestHandler) {
      void this.kernelRequestHandler(msg)
    }
  }

  sendResponseToPlugin(msg: KernelResponse): void {
    if (this.isDestroyed) return
    const pending = this.pendingRequests.get(msg.id)
    if (pending) {
      this.pendingRequests.delete(msg.id)
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
      this.pendingRequests.set(msg.id, { resolve, reject })
      if (this.kernelRequestHandler) {
        this.kernelRequestHandler(msg).catch((err) => {
          this.pendingRequests.delete(msg.id)
          reject(err)
        })
      } else {
        this.pendingRequests.delete(msg.id)
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
      this.pendingRequests.set(msg.id, { resolve, reject })
      if (this.pluginRequestHandler) {
        this.pluginRequestHandler(msg).catch((err) => {
          this.pendingRequests.delete(msg.id)
          reject(err)
        })
      } else {
        this.pendingRequests.delete(msg.id)
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
