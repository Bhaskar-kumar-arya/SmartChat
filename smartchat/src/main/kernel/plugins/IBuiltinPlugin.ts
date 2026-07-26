import { PluginManifest } from './PluginManifest'
import { PluginContext } from './PluginContext'

export interface IBuiltinPlugin {
  readonly id: string
  readonly manifest: PluginManifest
  activate(ctx: PluginContext): Promise<void>
  deactivate(): Promise<void>
}
