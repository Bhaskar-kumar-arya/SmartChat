import { ICapabilityProvider } from '../ICapabilityProvider'
import { IExtensionContactsAPI } from '../../context/ExtensionContext'
import { IContactService } from '../../../services/contacts/IContactService'
import { ExtensionManifest } from '../../types/ExtensionManifest'

export class ContactsCapabilityProvider implements ICapabilityProvider<IExtensionContactsAPI> {
  readonly permissions = ['contacts:read']

  constructor(private readonly contactService: IContactService) {}

  build(manifest: ExtensionManifest, _extensionId: string): IExtensionContactsAPI | undefined {
    if (!manifest.permissions?.includes('contacts:read')) {
      return undefined
    }

    return {
      getSelfJid: async () => {
        try {
          return await this.contactService.getMePhoneNumberJid()
        } catch (error) {
          console.error('ContactsCapabilityProvider.getSelfJid error:', error)
          return null
        }
      }
    }
  }
}
