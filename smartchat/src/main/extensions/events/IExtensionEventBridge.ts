import { ExtensionEventName } from '../context/ExtensionEventMap'

export interface IExtensionEventBridge {
  subscribeExtension(
    extensionId: string,
    event: ExtensionEventName,
    handler: (payload: unknown) => void | Promise<void>
  ): () => void
  
  unsubscribeAll(extensionId: string): void
}
