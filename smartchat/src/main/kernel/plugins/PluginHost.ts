import { IPluginHost, PluginMetadata } from './IPluginHost'
import { IBuiltinPlugin } from './IBuiltinPlugin'
import { PluginRegistry } from './PluginRegistry'
import { PluginLoader } from './PluginLoader'
import { KernelAPIRouter } from '../KernelAPIRouter'
import { IContributionRegistry } from '../contributions/IContributionRegistry'
import { ContributionSlot } from '../contributions/ContributionPoints'
import { DirectPluginChannel } from '../channels/DirectPluginChannel'
import { PluginContext } from './PluginContext'

export class PluginHost implements IPluginHost {
  private builtinPlugins = new Map<string, IBuiltinPlugin>()
  private handlers = new Map<string, Function>()

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

    channel.onKernelRequest(async (req) => {
      const parts = req.type.split(':')
      const slot = parts.slice(2).join(':') as ContributionSlot
      const payload = req.payload as { id?: string; name?: string; context?: Record<string, unknown> } | undefined
      const targetId = payload?.id || payload?.name || ''
      const key = `${plugin.id}:${slot}:${targetId}`
      const handler = this.handlers.get(key)
      if (handler) {
        await (handler as Function)(payload)
      }
      channel.sendResponseToPlugin({ id: req.id, ok: true })
    })

    const request = async (type: string, payload?: unknown) => {
      const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const res = await channel.requestFromPlugin({ id: reqId, type, payload })
      if (!res.ok) {
        throw new Error(res.error?.message || `Kernel request failed: ${type}`)
      }
      return res.payload
    }

    const ctx: PluginContext = {
      id: plugin.id,
      manifest: plugin.manifest,
      log: {
        info: (msg: string, ...data: unknown[]) => console.log(`[Plugin:${plugin.id}] ${msg}`, ...data),
        warn: (msg: string, ...data: unknown[]) => console.warn(`[Plugin:${plugin.id}] ${msg}`, ...data),
        error: (msg: string, ...data: unknown[]) => console.error(`[Plugin:${plugin.id}] ${msg}`, ...data)
      },
      chats: {
        getList: (page = 1, limit = 50) => request('kernel:chats:getList', { page, limit }) as Promise<any>,
        getById: (jid: string) => request('kernel:chats:getById', { jid }) as Promise<any>,
        pin: (jid: string) => request('kernel:chats:pin', { jid }) as Promise<void>,
        unpin: (jid: string) => request('kernel:chats:unpin', { jid }) as Promise<void>,
        archive: (jid: string) => request('kernel:chats:archive', { jid }) as Promise<void>,
        unarchive: (jid: string) => request('kernel:chats:unarchive', { jid }) as Promise<void>,
        mute: (jid: string, durationMs: number) => request('kernel:chats:mute', { jid, durationMs }) as Promise<void>,
        unmute: (jid: string) => request('kernel:chats:unmute', { jid }) as Promise<void>,
        markRead: (jid: string) => request('kernel:chats:markRead', { jid }) as Promise<void>
      },
      messages: {
        getMessages: (jid: string, page = 1, limit = 50) => request('kernel:messages:getMessages', { jid, page, limit }) as Promise<any>,
        send: (jid: string, text: string, options?: any) => request('kernel:messages:send', { jid, text, options }) as Promise<any>,
        delete: (jid: string, messageId: string) => request('kernel:messages:delete', { jid, messageId }) as Promise<void>,
        react: (jid: string, messageId: string, emoji: string) => request('kernel:messages:react', { jid, messageId, emoji }) as Promise<void>
      },
      contacts: {
        getByJid: (jid: string) => request('kernel:contacts:getByJid', { jid }) as Promise<any>
      },
      ai: {
        chat: (prompt: string, options?: any) => request('kernel:ai:chat', { prompt, options }) as Promise<string>,
        callTool: (toolName: string, args: Record<string, unknown>) => request('kernel:ai:callTool', { toolName, args }) as Promise<{ text: string }>
      },
      ui: {
        notify: (opts: { title: string; body: string }) => request('kernel:ui:notify', opts) as Promise<void>,
        toast: (msg: string, level?: string) => request('kernel:ui:toast', { msg, level }) as any
      },
      storage: {
        get: (key: string) => request('kernel:storage:get', { key }) as Promise<any>,
        set: (key: string, value: unknown) => request('kernel:storage:set', { key, value }) as Promise<void>,
        delete: (key: string) => request('kernel:storage:delete', { key }) as Promise<void>,
        clear: () => request('kernel:storage:clear', {}) as Promise<void>,
        keys: () => request('kernel:storage:keys', {}) as Promise<string[]>
      },
      contributions: {
        registerChatAction: (id, handler) => {
          const decl = plugin.manifest.contributions.chatActions?.find((a) => a.id === id)
          this.contributionRegistry.register('chat-action', {
            pluginId: plugin.id,
            id,
            label: decl?.label ?? id,
            icon: decl?.icon,
            when: decl?.when
          })
          this.handlers.set(`${plugin.id}:chat-action:${id}`, handler)
        },
        registerMessageAction: (id, handler) => {
          const decl = plugin.manifest.contributions.messageActions?.find((a) => a.id === id)
          this.contributionRegistry.register('message-action', {
            pluginId: plugin.id,
            id,
            label: decl?.label ?? id,
            icon: decl?.icon,
            when: decl?.when
          })
          this.handlers.set(`${plugin.id}:message-action:${id}`, handler)
        },
        registerChatBadge: (id, compute) => {
          const decl = plugin.manifest.contributions.chatBadges?.find((b) => b.id === id)
          this.contributionRegistry.register('chat-badge', {
            pluginId: plugin.id,
            id,
            label: decl?.label
          })
          this.handlers.set(`${plugin.id}:chat-badge:${id}`, compute)
        },
        registerAITool: (name, execute) => {
          const decl = plugin.manifest.contributions.aiTools?.find((t) => t.name === name)
          this.contributionRegistry.register('ai-tool', {
            pluginId: plugin.id,
            name,
            description: decl?.description ?? '',
            schema: decl?.schema ?? {}
          })
          this.handlers.set(`${plugin.id}:ai-tool:${name}`, execute)
        },
        registerSidebarPanel: (id, opts) => {
          this.contributionRegistry.register('sidebar-panel', {
            pluginId: plugin.id,
            id,
            title: opts.title,
            icon: opts.icon,
            panel: opts.panel
          })
        },
        registerSettingsPage: (id, opts) => {
          this.contributionRegistry.register('settings-page', {
            pluginId: plugin.id,
            id,
            title: opts.title,
            panel: opts.panel
          })
        },
        registerSlashCommand: (name, handler) => {
          const decl = plugin.manifest.contributions.slashCommands?.find((s) => s.name === name)
          this.contributionRegistry.register('slash-command', {
            pluginId: plugin.id,
            name,
            description: decl?.description ?? name
          })
          this.handlers.set(`${plugin.id}:slash-command:${name}`, handler)
        }
      }
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

    const contribs = manifest.contributions
    if (contribs) {
      if (contribs.chatActions) contribs.chatActions.forEach(c => this.contributionRegistry.register('chat-action', { pluginId: id, id: c.id, label: c.label, icon: c.icon, when: c.when }))
      if (contribs.messageActions) contribs.messageActions.forEach(c => this.contributionRegistry.register('message-action', { pluginId: id, id: c.id, label: c.label, icon: c.icon, when: c.when }))
      if (contribs.chatBadges) contribs.chatBadges.forEach(c => this.contributionRegistry.register('chat-badge', { pluginId: id, id: c.id, label: c.label }))
      if (contribs.slashCommands) contribs.slashCommands.forEach(c => this.contributionRegistry.register('slash-command', { pluginId: id, name: c.name, description: c.description }))
      if (contribs.keyboardShortcuts) contribs.keyboardShortcuts.forEach(c => this.contributionRegistry.register('keyboard-shortcut', { pluginId: id, id: c.id, defaultBinding: c.defaultBinding, description: c.description }))
      if (contribs.statusBarItems) contribs.statusBarItems.forEach(c => this.contributionRegistry.register('status-bar-item', { pluginId: id, id: c.id, alignment: c.alignment }))
      if (contribs.chatFilters) contribs.chatFilters.forEach(c => this.contributionRegistry.register('chat-filter', { pluginId: id, id: c.id, label: c.label, icon: c.icon }))
      if (contribs.chatSortStrategies) contribs.chatSortStrategies.forEach(c => this.contributionRegistry.register('chat-sort-strategy', { pluginId: id, id: c.id, label: c.label }))
      if (contribs.sidebarPanels) contribs.sidebarPanels.forEach(c => this.contributionRegistry.register('sidebar-panel', { pluginId: id, id: c.id, title: c.title, icon: c.icon, panel: c.panel }))
      if (contribs.settingsPages) contribs.settingsPages.forEach(c => this.contributionRegistry.register('settings-page', { pluginId: id, id: c.id, title: c.title, panel: c.panel }))
      if (contribs.aiTools) contribs.aiTools.forEach(c => this.contributionRegistry.register('ai-tool', { pluginId: id, name: c.name, description: c.description, schema: c.schema }))
    }

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

    for (const key of this.handlers.keys()) {
      if (key.startsWith(`${id}:`)) {
        this.handlers.delete(key)
      }
    }
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
