import { PluginMetadata } from './IPluginHost'

export class PluginRegistry {
  private plugins = new Map<string, PluginMetadata>()

  register(metadata: PluginMetadata): void {
    this.plugins.set(metadata.id, metadata)
  }

  unregister(id: string): boolean {
    return this.plugins.delete(id)
  }

  get(id: string): PluginMetadata | undefined {
    return this.plugins.get(id)
  }

  listLoaded(): string[] {
    return Array.from(this.plugins.keys())
  }
}
