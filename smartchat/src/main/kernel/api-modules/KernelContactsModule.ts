import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { IContactService } from '../../services/contacts/IContactService'
import { IAliasRepository } from '../../services/contacts/IAliasRepository'
import { KernelError, KernelNotFoundError } from './KernelErrors'

export class KernelContactsModule extends BaseKernelModule {
  readonly namespace = 'kernel:contacts'

  constructor(
    permissions: IPermissionStore,
    private readonly contactService: IContactService,
    private readonly aliasRepository?: IAliasRepository
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

      case 'batchGetByJids': {
        const { jids } = payload as { jids: string[] }
        this.requireCapability(pluginId, 'contacts:read')
        // Per-jid scope check, mirroring getByJid — drop jids outside the
        // allow-list before resolving. Default-allow, so unscoped plugins are
        // unaffected. (S7-01)
        const allowedJids = (jids || []).filter((jid) =>
          this.permissions.isResourceAllowed(pluginId, 'contacts:read', jid)
        )
        const nameMap = await this.contactService.batchResolveNames(allowedJids)
        const results: Array<{ jid: string; name: string }> = []
        for (const [jid, name] of nameMap.entries()) {
          results.push({ jid, name })
        }
        return results
      }

      case 'getMe': {
        this.requireCapability(pluginId, 'contacts:read')
        const jids = await this.contactService.getMeJids()
        const phoneNumberJid = await this.contactService.getMePhoneNumberJid()
        return {
          jids,
          phoneNumberJid
        }
      }

      case 'upsertContact': {
        const { contact } = payload as {
          contact: {
            id: string
            lid?: string | null
            phoneNumber?: string | null
            name?: string | null
            notify?: string | null
            pushName?: string | null
          }
        }
        this.requireCapability(pluginId, 'contacts:write')
        if (contact?.id) {
          this.requireResourceScope(pluginId, 'contacts:write', contact.id)
        }
        await this.contactService.upsertContact(contact)
        return { success: true }
      }

      case 'resolveLid': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'contacts:read')
        this.requireResourceScope(pluginId, 'contacts:read', jid)
        const lid = await this.contactService.resolveLidFromJid(jid)
        return { jid, lid }
      }

      case 'getAlias': {
        const { jid } = payload as { jid: string }
        this.requireCapability(pluginId, 'contacts:read')
        this.requireResourceScope(pluginId, 'contacts:read', jid)
        if (!this.aliasRepository) {
          throw new KernelError('INTERNAL_ERROR', 'AliasRepository is not available in KernelContactsModule')
        }
        const alias = await this.aliasRepository.findIdentityAlias(jid)
        return this.serialize(alias)
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }
}
