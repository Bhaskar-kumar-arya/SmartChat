import { ICapabilityProvider } from '../ICapabilityProvider'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionDedicatedChatAPI, DedicatedChatContent } from '../../context/ExtensionContext'
import { IDedicatedChatRepository } from '../../dedicatedChat/IDedicatedChatRepository'
import { BrowserWindow } from 'electron'

export class DedicatedChatCapabilityProvider implements ICapabilityProvider<IExtensionDedicatedChatAPI> {
  readonly permissions = ['ui:dedicated_chat']

  constructor(
    private readonly chatRepo: IDedicatedChatRepository,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  build(manifest: ExtensionManifest): IExtensionDedicatedChatAPI | undefined {
    if (!manifest.permissions.includes('ui:dedicated_chat')) {
      return undefined
    }

    const extensionId = manifest.id

    return {
      send: async (content: DedicatedChatContent): Promise<void> => {
        const payload = JSON.stringify(content)
        await this.chatRepo.append(extensionId, 'extension', payload)
        
        const win = this.getWindow()
        if (win) {
          win.webContents.send('extension:chat-push', { 
            extensionId, 
            message: {
              id: Date.now().toString(),
              extensionId,
              role: 'extension',
              content: payload,
              createdAt: new Date()
            } 
          })
        }
      },
      getHistory: async (limit?: number) => {
        return this.chatRepo.getHistory(extensionId, limit)
      },
      clearHistory: async () => {
        await this.chatRepo.clear(extensionId)
      },
      focus: () => {
        const win = this.getWindow()
        if (win) {
          win.webContents.send('extension:chat-focus', { extensionId })
        }
      }
    }
  }
}
