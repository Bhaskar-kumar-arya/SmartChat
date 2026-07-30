import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'

export class KernelLogModule extends BaseKernelModule {
  readonly namespace = 'kernel:log'

  constructor(permissions: IPermissionStore) {
    super(permissions)
  }

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const { level, message, data } = (payload as { level?: string; message?: string; data?: unknown[] }) || {}
    const dataStr = data && Array.isArray(data) && data.length > 0 ? ` | Data: ${JSON.stringify(data)}` : ''
    const logLevel = level || (type.includes(':') ? type.split(':').pop() : 'info') || 'info'

    switch (logLevel) {
      case 'warn':
        console.warn(`[Plugin:${pluginId}] [WARN] ${message || ''}${dataStr}`)
        break
      case 'error':
        console.error(`[Plugin:${pluginId}] [ERROR] ${message || ''}${dataStr}`)
        break
      case 'info':
      default:
        console.log(`[Plugin:${pluginId}] [INFO] ${message || ''}${dataStr}`)
        break
    }

    return { success: true }
  }
}
