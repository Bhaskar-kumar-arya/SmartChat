import { IKernelModule } from './IKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'

export interface IKernelStorageRepository {
  get(pluginId: string, key: string): Promise<string | undefined>
  set(pluginId: string, key: string, value: string): Promise<void>
  delete(pluginId: string, key: string): Promise<void>
  clear(pluginId: string): Promise<void>
  keys(pluginId: string): Promise<string[]>
}

export class KernelStorageModule implements IKernelModule {
  readonly namespace = 'kernel:storage'

  constructor(
    private readonly permissions: IPermissionStore,
    private readonly storageRepo?: IKernelStorageRepository
  ) {}

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'get': {
        const { key } = payload as { key: string }
        this.requireCapability(pluginId, 'storage:read')
        const raw = await this.storageRepo?.get(pluginId, key)
        if (raw === undefined) return undefined
        try {
          return JSON.parse(raw)
        } catch {
          return raw
        }
      }

      case 'set': {
        const { key, value } = payload as { key: string; value: unknown }
        this.requireCapability(pluginId, 'storage:write')
        const raw = typeof value === 'string' ? value : JSON.stringify(value)
        await this.storageRepo?.set(pluginId, key, raw)
        return { success: true }
      }

      case 'delete': {
        const { key } = payload as { key: string }
        this.requireCapability(pluginId, 'storage:write')
        await this.storageRepo?.delete(pluginId, key)
        return { success: true }
      }

      case 'clear': {
        this.requireCapability(pluginId, 'storage:write')
        await this.storageRepo?.clear(pluginId)
        return { success: true }
      }

      case 'keys': {
        this.requireCapability(pluginId, 'storage:read')
        return (await this.storageRepo?.keys(pluginId)) || []
      }

      default:
        throw {
          code: 'NOT_FOUND',
          message: `Unknown action '${type}' in module '${this.namespace}'`
        }
    }
  }

  private extractAction(type: string): string {
    const parts = type.split(':')
    return parts.length > 2 ? parts.slice(2).join(':') : parts[1] || type
  }

  private requireCapability(pluginId: string, capability: string): void {
    if (!this.permissions.hasCapability(pluginId, capability)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' lacks capability '${capability}'`,
        permission: capability
      }
    }
  }
}
