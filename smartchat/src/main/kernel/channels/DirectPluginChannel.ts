import { IPluginChannel, KernelRequest, KernelResponse } from './IPluginChannel'

export class DirectPluginChannel implements IPluginChannel {
  private pluginRequestHandler: ((msg: KernelRequest) => Promise<void>) | null = null
  private kernelRequestHandler: ((msg: KernelRequest) => Promise<void>) | null = null
  private kernelResponseHandler: ((msg: KernelResponse) => void) | null = null
  private isDestroyed = false

  sendToPlugin(msg: KernelRequest): void {
    if (this.isDestroyed) return
    if (this.kernelRequestHandler) {
      void this.kernelRequestHandler(msg)
    }
  }

  sendResponseToPlugin(msg: KernelResponse): void {
    if (this.isDestroyed) return
    if (this.kernelResponseHandler) {
      this.kernelResponseHandler(msg)
    }
  }

  onPluginRequest(handler: (msg: KernelRequest) => Promise<void>): void {
    this.pluginRequestHandler = handler
  }

  destroy(): void {
    this.isDestroyed = true
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

  onKernelRequest(handler: (msg: KernelRequest) => Promise<void>): void {
    this.kernelRequestHandler = handler
  }

  onKernelResponse(handler: (msg: KernelResponse) => void): void {
    this.kernelResponseHandler = handler
  }
}
