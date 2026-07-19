import { IExtensionHost } from './IExtensionHost'
import { IExtensionLoader } from './IExtensionLoader'
import { IExtensionCapabilityRegistry } from '../capabilities/IExtensionCapabilityRegistry'
import { ExtensionManifest } from '../types/ExtensionManifest'
import { ExtensionContext } from '../context/ExtensionContext'
import { ExtensionLoadError } from '../types/ExtensionErrors'

export class ExtensionHost implements IExtensionHost {
  private loadedManifests = new Map<string, ExtensionManifest>()
  private contexts = new Map<string, ExtensionContext>()

  constructor(
    private loader: IExtensionLoader,
    private registry: IExtensionCapabilityRegistry,
    private schedulerService?: any,
    private virtualChatProv?: any
  ) {}

  async loadAll(): Promise<void> {
    const manifests = await this.loader.listInstalled()
    for (const manifest of manifests) {
      try {
        await this.load(manifest.id)
      } catch (error) {
        console.error(`Failed to load extension ${manifest.id}:`, error)
      }
    }
  }

  async load(id: string): Promise<void> {
    if (this.loadedManifests.has(id)) {
      return
    }

    const manifests = await this.loader.listInstalled()
    const manifest = manifests.find((m) => m.id === id)
    if (!manifest) {
      throw new ExtensionLoadError(`Manifest not found for extension ${id}`)
    }

    const mod = await this.loader.load(id)
    
    // Build the raw context from the registry
    const ctx = this.registry.buildContext(manifest)

    const activateHandlers: Array<() => Promise<void>> = []
    const deactivateHandlers: Array<() => Promise<void>> = []

    // Wrap the context to capture lifecycle handlers
    const capturedCtx = {
      ...ctx,
      onActivate: (fn: () => Promise<void>) => {
        activateHandlers.push(fn)
      },
      onDeactivate: (fn: () => Promise<void>) => {
        deactivateHandlers.push(fn)
      }
    } as ExtensionContext

    // Execute module entry point
    if (typeof mod === 'function') {
      await mod(capturedCtx)
    } else if (mod && typeof mod.activate === 'function') {
      await mod.activate(capturedCtx)
      if (typeof mod.deactivate === 'function') {
        deactivateHandlers.push(() => mod.deactivate!())
      }
    }

    // Run all registered activate handlers
    for (const handler of activateHandlers) {
      await handler()
    }

    if (this.virtualChatProv && this.virtualChatProv.upsert) {
      await this.virtualChatProv.upsert(id, manifest)
    }

    this.loadedManifests.set(id, manifest)
    this.contexts.set(id, capturedCtx)

    // Store deactivate handlers for unload
    ;(capturedCtx as any).__deactivateHandlers = deactivateHandlers
  }

  async unload(id: string): Promise<void> {
    if (!this.loadedManifests.has(id)) {
      return
    }

    const ctx = this.contexts.get(id)
    if (ctx) {
      const deactivateHandlers = (ctx as any).__deactivateHandlers as Array<() => Promise<void>>
      if (deactivateHandlers) {
        for (const handler of deactivateHandlers) {
          try {
            await handler()
          } catch (e) {
            console.error(`Error during extension ${id} deactivate:`, e)
          }
        }
      }
    }

    if (this.schedulerService && this.schedulerService.cancelAll) {
      this.schedulerService.cancelAll(id)
    }

    if (this.virtualChatProv && this.virtualChatProv.remove) {
      await this.virtualChatProv.remove(id)
    }

    this.loadedManifests.delete(id)
    this.contexts.delete(id)
  }

  async reload(id: string): Promise<void> {
    await this.unload(id)
    await this.loader.reload(id)
    await this.load(id)
  }

  getManifest(id: string): ExtensionManifest | undefined {
    return this.loadedManifests.get(id)
  }

  listLoaded(): string[] {
    return Array.from(this.loadedManifests.keys())
  }
}
