import { IKernelModule } from './IKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IContactService } from '../../services/contacts/IContactService'

export class KernelContactsModule implements IKernelModule {
  readonly namespace = 'kernel:contacts'

  constructor(
    private readonly permissions: IPermissionStore,
    private readonly contactService: IContactService
  ) {}

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'getByJid': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'contacts:read')
        this.requireResourceScope(pluginId, 'contacts:read', jid)
        const name = await this.contactService.resolveName(jid, null)
        return {
          jid,
          name
        }
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

  private requireResourceScope(pluginId: string, capability: string, resourceId: string): void {
    if (!this.permissions.isResourceAllowed(pluginId, capability, resourceId)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' is denied access to resource '${resourceId}' for capability '${capability}'`,
        permission: capability
      }
    }
  }
}
