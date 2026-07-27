import { IKernelModule } from './api-modules/IKernelModule'
import { IPluginChannel, KernelRequest } from './channels/IPluginChannel'

export interface IKernelAPIRouter {
  registerModule(module: IKernelModule): void
  unregisterModule(namespace: string): void
  getModule(namespace: string): IKernelModule | undefined
  attachChannel(pluginId: string, channel: IPluginChannel): () => void
  handleRequest(pluginId: string, channel: IPluginChannel, request: KernelRequest): Promise<void>
}
