import { ICapabilityProvider } from '../ICapabilityProvider'
import { IExtensionChatsAPI } from '../../context/ExtensionContext'
import { IChatService } from '../../../services/chats/IChatService'
import { ExtensionManifest } from '../../types/ExtensionManifest'

export class ChatsCapabilityProvider implements ICapabilityProvider<IExtensionChatsAPI> {
  readonly permissions = ['chats:read']

  constructor(private readonly chatService: IChatService) {}

  build(manifest: ExtensionManifest, _extensionId: string): IExtensionChatsAPI | undefined {
    if (!manifest.permissions?.includes('chats:read')) {
      return undefined
    }

    return {
      list: async (limit = 10) => {
        try {
          const chats = await this.chatService.getChatList(1, limit)
          return chats
        } catch (error) {
          console.error('ChatsCapabilityProvider.list error:', error)
          return []
        }
      }
    }
  }
}
