import { PluginManifest } from './PluginManifest'
import { IPluginChannel } from '../channels/IPluginChannel'

export interface IPluginLoader {
  install(scextPath: string): Promise<PluginManifest>
  uninstall(id: string): Promise<void>
  load(id: string): Promise<{ manifest: PluginManifest; channel: IPluginChannel }>
  reload(id: string): Promise<{ manifest: PluginManifest; channel: IPluginChannel }>
  listInstalled(): Promise<PluginManifest[]>
}
