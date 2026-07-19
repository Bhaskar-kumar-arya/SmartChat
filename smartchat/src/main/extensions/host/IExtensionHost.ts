import { ExtensionManifest } from '../types/ExtensionManifest'

export interface IExtensionHost {
  loadAll(): Promise<void>
  load(id: string): Promise<void>
  unload(id: string): Promise<void>
  reload(id: string): Promise<void>
  getManifest(id: string): ExtensionManifest | undefined
  listLoaded(): string[]
}
