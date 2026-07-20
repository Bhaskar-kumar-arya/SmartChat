import { ICapabilityProvider } from '../ICapabilityProvider'
import { IExtensionContactsAPI } from '../../context/ExtensionContext'
import { IContactService } from '../../../services/contacts/IContactService'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IDocSource, DocSection } from '../../docs/IDocSource'
import { GENERATED_INTERFACES } from '../../docs/generatedDocs'

export class ContactsCapabilityProvider implements ICapabilityProvider<IExtensionContactsAPI>, IDocSource {
  public getDocSection(): DocSection {
    let body = `Access contact information.\n\n`
    if (GENERATED_INTERFACES['IExtensionContactsAPI']) {
      body += `${GENERATED_INTERFACES['IExtensionContactsAPI']}\n`
    }
    return {
      heading: 'ctx.contacts',
      permissions: ['contacts:read'],
      body: body.trim()
    }
  }

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
