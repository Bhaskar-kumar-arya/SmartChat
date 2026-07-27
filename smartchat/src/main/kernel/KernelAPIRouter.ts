import { IKernelModule } from './api-modules/IKernelModule'
import { IPluginChannel, KernelRequest, KernelResponse, KernelErrorPayload } from './channels/IPluginChannel'
import { IKernelAPIRouter } from './IKernelAPIRouter'

interface PermissionErrorLike {
  code: string
  message: string
  permission?: string
}

function isPermissionError(err: unknown): err is PermissionErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as PermissionErrorLike).code === 'string' &&
    'message' in err &&
    typeof (err as PermissionErrorLike).message === 'string'
  )
}

export class KernelAPIRouter implements IKernelAPIRouter {
  private modules = new Map<string, IKernelModule>()

  registerModule(module: IKernelModule): void {
    this.modules.set(module.namespace, module)
  }

  unregisterModule(namespace: string): void {
    this.modules.delete(namespace)
  }

  getModule(namespace: string): IKernelModule | undefined {
    return this.modules.get(namespace)
  }

  attachChannel(pluginId: string, channel: IPluginChannel): () => void {
    channel.onPluginRequest(async (request: KernelRequest) => {
      await this.handleRequest(pluginId, channel, request)
    })
    return () => {
      // Detach callback if needed
    }
  }

  async handleRequest(pluginId: string, channel: IPluginChannel, request: KernelRequest): Promise<void> {
    const namespace = this.extractNamespace(request.type)
    const module = namespace ? this.modules.get(namespace) : undefined

    if (!module) {
      const response: KernelResponse = {
        id: request.id,
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: `No kernel module registered for type '${request.type}' (extracted namespace: '${namespace ?? 'none'}')`
        }
      }
      channel.sendResponseToPlugin(response)
      return
    }

    try {
      const result = await module.handle(pluginId, request.type, request.payload)
      const response: KernelResponse = {
        id: request.id,
        ok: true,
        payload: result
      }
      channel.sendResponseToPlugin(response)
    } catch (err: unknown) {
      const errorPayload: KernelErrorPayload = isPermissionError(err)
        ? {
            code: err.code,
            message: err.message,
            ...(err.permission ? { permission: err.permission } : {})
          }
        : {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : String(err)
          }

      const response: KernelResponse = {
        id: request.id,
        ok: false,
        error: errorPayload
      }
      channel.sendResponseToPlugin(response)
    }
  }

  private extractNamespace(type: string): string | null {
    if (this.modules.has(type)) {
      return type
    }
    const parts = type.split(':')
    if (parts.length >= 2) {
      const prefix = parts.slice(0, 2).join(':')
      if (this.modules.has(prefix)) {
        return prefix
      }
    }
    return parts[0] || null
  }
}
