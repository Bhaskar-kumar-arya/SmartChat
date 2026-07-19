import { ExtensionManifest } from '../types/ExtensionManifest'
import { ExtensionEventName, ExtensionEventMap } from './ExtensionEventMap'

export interface IExtensionEventAPI {
  on<K extends ExtensionEventName>(
    event: K,
    handler: (payload: ExtensionEventMap[K]) => void | Promise<void>
  ): () => void
}

export interface IExtensionLogAPI {
  info(msg: string, ...data: any[]): void
  warn(msg: string, ...data: any[]): void
  error(msg: string, ...data: any[]): void
}

export interface IExtensionStorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}

export interface ExtensionContext {
  readonly extensionId: string
  readonly manifest: ExtensionManifest
  readonly log: IExtensionLogAPI

  onActivate(fn: () => Promise<void>): void
  onDeactivate(fn: () => Promise<void>): void

  readonly storage?: IExtensionStorageAPI
  readonly events?: IExtensionEventAPI
}
