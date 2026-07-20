import { ICapabilityProvider } from '../ICapabilityProvider'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionStorageAPI } from '../../context/ExtensionContext'
import { IExtensionStorageRepository } from '../../storage/IExtensionStorageRepository'
import { IDocSource, DocSection } from '../../docs/IDocSource'
import { GENERATED_INTERFACES } from '../../docs/generatedDocs'

export class StorageCapabilityProvider implements ICapabilityProvider<IExtensionStorageAPI>, IDocSource {
  public getDocSection(): DocSection {
    let body = `Persistent isolated key-value store.\n\n`
    if (GENERATED_INTERFACES['IExtensionStorageAPI']) {
      body += `${GENERATED_INTERFACES['IExtensionStorageAPI']}\n`
    }
    return {
      heading: 'ctx.storage',
      permissions: ['storage:read', 'storage:write'],
      body: body.trim()
    }
  }

  readonly permissions = ['storage:read', 'storage:write']

  constructor(private storageRepo: IExtensionStorageRepository) {}

  build(manifest: ExtensionManifest, extensionId: string): IExtensionStorageAPI | undefined {
    const hasRead = manifest.permissions.includes('storage:read')
    const hasWrite = manifest.permissions.includes('storage:write')

    if (!hasRead && !hasWrite) {
      return undefined
    }

    return {
      get: async <T = unknown>(key: string): Promise<T | undefined> => {
        if (!hasRead) throw new Error(`Permission denied: extension ${extensionId} lacks 'storage:read' permission`)
        const val = await this.storageRepo.get(extensionId, key)
        if (val === undefined) return undefined
        try {
          return JSON.parse(val) as T
        } catch {
          return val as T
        }
      },
      set: async (key: string, value: unknown): Promise<void> => {
        if (!hasWrite) throw new Error(`Permission denied: extension ${extensionId} lacks 'storage:write' permission`)
        await this.storageRepo.set(extensionId, key, JSON.stringify(value))
      },
      delete: async (key: string): Promise<void> => {
        if (!hasWrite) throw new Error(`Permission denied: extension ${extensionId} lacks 'storage:write' permission`)
        await this.storageRepo.delete(extensionId, key)
      },
      clear: async (): Promise<void> => {
        if (!hasWrite) throw new Error(`Permission denied: extension ${extensionId} lacks 'storage:write' permission`)
        await this.storageRepo.clear(extensionId)
      },
      keys: async (): Promise<string[]> => {
        if (!hasRead) throw new Error(`Permission denied: extension ${extensionId} lacks 'storage:read' permission`)
        return await this.storageRepo.keys(extensionId)
      }
    }
  }
}
