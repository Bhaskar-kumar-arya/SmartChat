import { IExtensionCapabilityRegistry } from './IExtensionCapabilityRegistry'
import { ICapabilityProvider } from './ICapabilityProvider'
import { ExtensionManifest } from '../types/ExtensionManifest'
import { ExtensionContext } from '../context/ExtensionContext'
export class ExtensionCapabilityRegistry implements IExtensionCapabilityRegistry {
  private providers: Map<string, ICapabilityProvider<any>> = new Map()

  register<K>(key: string, provider: ICapabilityProvider<K>): void {
    this.providers.set(key, provider)
  }

  buildContext(manifest: ExtensionManifest): ExtensionContext {
    const extensionId = manifest.id
    
    // Initialize context with base fields. 
    // onActivate and onDeactivate will be properly attached by ExtensionHost
    const context: Partial<ExtensionContext> = {
      extensionId,
      manifest,
      onActivate: () => {}, 
      onDeactivate: () => {}
    }

    for (const [key, provider] of this.providers.entries()) {
      const api = provider.build(manifest, extensionId)
      if (api !== undefined) {
        (context as any)[key] = api
      }
    }

    return context as ExtensionContext
  }
}
