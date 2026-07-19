import { ICapabilityProvider } from '../ICapabilityProvider'
import { IExtensionEventAPI } from '../../context/ExtensionContext'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionEventBridge } from '../../events/IExtensionEventBridge'

export class EventCapabilityProvider implements ICapabilityProvider<IExtensionEventAPI> {
  // It provides event capabilities. We check if they have any 'events:*' permission.
  public readonly permissions: string[] = [] // Not checked directly, we'll implement custom build logic.

  constructor(private readonly eventBridge: IExtensionEventBridge) {}

  public build(manifest: ExtensionManifest): IExtensionEventAPI | undefined {
    const hasAnyEventPerm = manifest.permissions.some(p => p.startsWith('events:'))
    
    // For now, if they request any events: permission, we provide the full API.
    // Finer-grained control can be implemented by validating the requested event 
    // against the permissions list at runtime.
    if (!hasAnyEventPerm) {
      return undefined
    }

    return {
      on: (event, handler) => {
        // Enforce specific event permissions if needed:
        // if (!manifest.permissions.includes(`events:${event}`)) {
        //   throw new PermissionError(...)
        // }
        return this.eventBridge.subscribeExtension(manifest.id, event, handler as (payload: unknown) => void | Promise<void>)
      }
    }
  }
}
