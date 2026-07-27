import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IContactService } from '../../services/contacts/IContactService'
import { KernelNotFoundError } from './KernelErrors'

export class KernelContactsModule extends BaseKernelModule {
  readonly namespace = 'kernel:contacts'

  constructor(
    permissions: IPermissionStore,
    private readonly contactService: IContactService
  ) {
    super(permissions)
  }

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
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }
}
