import { ExtensionManifest } from '../types/ExtensionManifest'

export interface IVirtualChatProvider {
  upsert(extensionId: string, manifest: ExtensionManifest): Promise<void>
  remove(extensionId: string): Promise<void>
}
