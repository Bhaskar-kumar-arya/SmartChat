import { PluginMetadata } from './IPluginHost'

export interface IPluginRegistry {
  register(metadata: PluginMetadata): void
  unregister(id: string): boolean
  get(id: string): PluginMetadata | undefined
  listLoaded(): string[]
}
