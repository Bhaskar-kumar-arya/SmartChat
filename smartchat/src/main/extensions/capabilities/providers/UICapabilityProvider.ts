import { ICapabilityProvider } from '../ICapabilityProvider'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionUIAPI } from '../../context/ExtensionContext'
import { INotificationService } from '../../../services/notification/INotificationService'
import { BrowserWindow } from 'electron'
import { IDocSource, DocSection } from '../../docs/IDocSource'
import { GENERATED_INTERFACES } from '../../docs/generatedDocs'

export class UICapabilityProvider implements ICapabilityProvider<IExtensionUIAPI>, IDocSource {
  public getDocSection(): DocSection {
    let body = `Show notifications and UI prompts.\n\n`
    if (GENERATED_INTERFACES['IExtensionUIAPI']) {
      body += `${GENERATED_INTERFACES['IExtensionUIAPI']}\n`
    }
    return {
      heading: 'ctx.ui',
      permissions: ['ui:notification'],
      body: body.trim()
    }
  }

  readonly permissions = ['ui:notification']

  constructor(
    private notificationService: INotificationService,
    private getMainWindow: () => BrowserWindow | null
  ) {}

  build(manifest: ExtensionManifest, extensionId: string): IExtensionUIAPI | undefined {
    if (!manifest.permissions.includes('ui:notification')) {
      return undefined
    }

    return {
      notify: async (opts) => {
        this.notificationService.notify({
          chatJid: `extension:${extensionId}`,
          chatName: opts.title,
          textContent: opts.body,
          senderName: 'Extension', // To display in non-group format as the title if chatName is empty, but since we set chatName, it acts as a fallback or subtitle
        })
      },
      toast: (msg, level = 'info') => {
        const win = this.getMainWindow()
        if (win) {
          win.webContents.send('ipc:ui:toast', { msg, level, extensionId })
        }
      },
      showSettings: async (_schema) => {
        throw new Error('showSettings is not yet implemented')
      }
    }
  }
}
