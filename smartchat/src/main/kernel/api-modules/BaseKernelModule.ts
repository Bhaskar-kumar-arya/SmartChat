import { IKernelModule } from './IKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'

export abstract class BaseKernelModule implements IKernelModule {
  abstract readonly namespace: string

  constructor(protected readonly permissions: IPermissionStore) {}

  abstract handle(pluginId: string, type: string, payload: unknown): Promise<unknown>

  protected extractAction(type: string): string {
    const parts = type.split(':')
    return parts.length > 2 ? parts.slice(2).join(':') : parts[1] || type
  }

  protected requireCapability(pluginId: string, capability: string): void {
    if (!this.permissions.hasCapability(pluginId, capability)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' lacks capability '${capability}'`,
        permission: capability
      }
    }
  }

  protected requireResourceScope(
    pluginId: string,
    capability: string,
    resourceId: string,
    resourceType: string = 'resource'
  ): void {
    if (!this.permissions.isResourceAllowed(pluginId, capability, resourceId)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' is denied access to ${resourceType} '${resourceId}' for capability '${capability}'`,
        permission: capability
      }
    }
  }

  protected serialize<T>(data: T): T {
    if (data === undefined || data === null) return data
    return JSON.parse(
      JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )
  }
}
