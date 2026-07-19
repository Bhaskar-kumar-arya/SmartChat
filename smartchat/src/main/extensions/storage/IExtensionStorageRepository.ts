export interface IExtensionStorageRepository {
  get(extensionId: string, key: string): Promise<string | undefined>
  set(extensionId: string, key: string, value: string): Promise<void>
  delete(extensionId: string, key: string): Promise<void>
  clear(extensionId: string): Promise<void>
  keys(extensionId: string): Promise<string[]>
}
