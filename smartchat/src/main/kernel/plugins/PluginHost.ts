import { IPluginHost, PluginMetadata } from './IPluginHost'
import { IBuiltinPlugin } from './IBuiltinPlugin'
import { PluginRegistry } from './PluginRegistry'
import { PluginLoader } from './PluginLoader'
import { KernelAPIRouter } from '../KernelAPIRouter'
import { IContributionRegistry } from '../contributions/IContributionRegistry'
import { DirectPluginChannel } from '../channels/DirectPluginChannel'
import { PluginContext } from './PluginContext'

export class PluginHost implements IPluginHost {
  private builtinPlugins = new Map<string, IBuiltinPlugin>()

  constructor(
    private readonly loader: PluginLoader,
    private readonly registry: PluginRegistry,
    private readonly router: KernelAPIRouter,
    private readonly contributionRegistry: IContributionRegistry
  ) {}

  async registerBuiltin(plugin: IBuiltinPlugin): Promise<void> {
    if (this.registry.get(plugin.id)) {
      return
    }

    const channel = new DirectPluginChannel()
    this.router.attachChannel(plugin.id, channel)

    const ctx: PluginContext = {
      id: plugin.id,
      manifest: plugin.manifest,
      log: {
        info: (msg: string, ...data: unknown[]) => console.log(`[Plugin:${plugin.id}] ${msg}`, ...data),
        warn: (msg: string, ...data: unknown[]) => console.warn(`[Plugin:${plugin.id}] ${msg}`, ...data),
        error: (msg: string, ...data: unknown[]) => console.error(`[Plugin:${plugin.id}] ${msg}`, ...data)
      },
      contributions: {}
    }

    const metadata: PluginMetadata = {
      id: plugin.id,
      manifest: plugin.manifest,
      channel,
      isBuiltin: true
    }

    this.registry.register(metadata)
    this.builtinPlugins.set(plugin.id, plugin)

    await plugin.activate(ctx)
  }

  async load(id: string): Promise<void> {
    if (this.registry.get(id)) {
      return
    }

    const { manifest, channel } = await this.loader.load(id)
    this.router.attachChannel(id, channel)

    const metadata: PluginMetadata = {
      id,
      manifest,
      channel,
      isBuiltin: false
    }

    this.registry.register(metadata)

    channel.sendToPlugin({
      id: `activate-${Date.now()}`,
      type: 'plugin:activate',
      payload: {}
    })
  }

  async unload(id: string): Promise<void> {
    const metadata = this.registry.get(id)
    if (!metadata) {
      return
    }

    if (metadata.isBuiltin) {
      const builtin = this.builtinPlugins.get(id)
      if (builtin) {
        await builtin.deactivate()
        this.builtinPlugins.delete(id)
      }
    } else {
      metadata.channel.sendToPlugin({
        id: `deactivate-${Date.now()}`,
        type: 'plugin:deactivate',
        payload: {}
      })
    }

    this.contributionRegistry.unregisterAll(id)
    metadata.channel.destroy()
    this.registry.unregister(id)
  }

  async reload(id: string): Promise<void> {
    await this.unload(id)
    await this.load(id)
  }

  async loadAll(): Promise<void> {
    const installed = await this.loader.listInstalled()
    for (const manifest of installed) {
      await this.load(manifest.id)
    }
  }

  getPlugin(id: string): PluginMetadata | undefined {
    return this.registry.get(id)
  }

  listLoaded(): string[] {
    return this.registry.listLoaded()
  }
}
