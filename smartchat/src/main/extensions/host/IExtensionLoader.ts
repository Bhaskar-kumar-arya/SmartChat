import { ExtensionManifest } from '../types/ExtensionManifest'

export type ExtensionModule =
  | ((ctx: any) => Promise<void>)
  | {
      activate(ctx: any): Promise<void>
      deactivate?(): Promise<void>
    }

export interface IExtensionLoader {
  install(scextPath: string): Promise<ExtensionManifest>
  uninstall(id: string): Promise<void>
  load(id: string): Promise<ExtensionModule>
  reload(id: string): Promise<ExtensionModule>
  listInstalled(): Promise<ExtensionManifest[]>
}
