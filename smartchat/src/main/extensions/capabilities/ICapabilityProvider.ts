import { ExtensionManifest } from '../types/ExtensionManifest'

export interface ICapabilityProvider<K> {
  readonly permissions: string[]
  build(manifest: ExtensionManifest, extensionId: string): K | undefined
}
