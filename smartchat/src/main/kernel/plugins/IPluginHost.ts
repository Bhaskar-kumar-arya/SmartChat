import { IBuiltinPlugin } from './IBuiltinPlugin'
import { IPluginChannel } from '../channels/IPluginChannel'
import { PluginManifest } from './PluginManifest'

export interface PluginMetadata {
  id: string
  manifest: PluginManifest
  channel: IPluginChannel
  isBuiltin: boolean
}

export interface IPluginHost {
  load(id: string): Promise<void>
  unload(id: string): Promise<void>
  reload(id: string): Promise<void>
  loadAll(): Promise<void>
  registerBuiltin(plugin: IBuiltinPlugin): Promise<void>
  getPlugin(id: string): PluginMetadata | undefined
  listLoaded(): string[]
}
