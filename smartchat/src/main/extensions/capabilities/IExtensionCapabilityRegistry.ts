import { ExtensionManifest } from '../types/ExtensionManifest'
import { ExtensionContext } from '../context/ExtensionContext'
import { ICapabilityProvider } from './ICapabilityProvider'

export interface IExtensionCapabilityRegistry {
  register<K>(key: string, provider: ICapabilityProvider<K>): void
  buildContext(manifest: ExtensionManifest): ExtensionContext
}
