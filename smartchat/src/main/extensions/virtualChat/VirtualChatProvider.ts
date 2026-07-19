import { IChatRepository } from '../../services/chats/IChatRepository'
import { ExtensionManifest } from '../types/ExtensionManifest'
import { IVirtualChatProvider } from './IVirtualChatProvider'

export class VirtualChatProvider implements IVirtualChatProvider {
  constructor(private readonly chatRepo: IChatRepository) {}

  async upsert(extensionId: string, manifest: ExtensionManifest): Promise<void> {
    if (!manifest.dedicatedChat) return

    const jid = `extension_${extensionId}`
    await this.chatRepo.upsertChat(jid, {
      type: 'EXTENSION',
      name: manifest.dedicatedChat.name || manifest.name,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    })
  }

  async remove(extensionId: string): Promise<void> {
    const jid = `extension_${extensionId}`
    await this.chatRepo.deleteChat(jid)
  }
}
