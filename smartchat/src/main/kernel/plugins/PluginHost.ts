import { IPluginHost, PluginMetadata } from './IPluginHost'
import { IBuiltinPlugin } from './IBuiltinPlugin'
import { IPluginRegistry } from './IPluginRegistry'
import { IPluginLoader } from './IPluginLoader'
import { IKernelAPIRouter } from '../IKernelAPIRouter'
import { IContributionRegistry } from '../contributions/IContributionRegistry'
import { ContributionSlot } from '../contributions/ContributionPoints'
import { DirectPluginChannel } from '../channels/DirectPluginChannel'
import { PluginContext } from './PluginContext'
import { ContributionsDeclaration } from './PluginManifest'
import {
  PluginChatItem,
  PluginGroupParticipant,
  PluginMessageItem,
  SendMessageOptions,
  PluginReceiptItem,
  PluginFavoriteStickerItem,
  PluginContactItem,
  PluginMeInfo,
  PluginContactInput,
  PluginAliasItem,
  AICallOptions,
  PluginAIModelInfo,
  PluginAISession
} from '../../../../packages/sdk/src/context'

type ManifestContributionMapper = {
  [K in keyof ContributionsDeclaration]-?: {
    key: K
    slot: ContributionSlot
    toContrib: (item: any, pluginId: string) => any
  }
}[keyof ContributionsDeclaration]

const MANIFEST_TO_SLOT_MAPPINGS: ManifestContributionMapper[] = [
  {
    key: 'chatActions',
    slot: 'chat-action',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, label: c.label, icon: c.icon, when: c.when, subMenu: c.subMenu })
  },
  {
    key: 'messageActions',
    slot: 'message-action',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, label: c.label, icon: c.icon, when: c.when, subMenu: c.subMenu })
  },
  {
    key: 'chatBadges',
    slot: 'chat-badge',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, label: c.label })
  },
  {
    key: 'messageRenderers',
    slot: 'message-renderer',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, messageType: c.messageType })
  },
  {
    key: 'slashCommands',
    slot: 'slash-command',
    toContrib: (c, pluginId) => ({ pluginId, name: c.name, description: c.description })
  },
  {
    key: 'sidebarPanels',
    slot: 'sidebar-panel',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, title: c.title, icon: c.icon, panel: c.panel })
  },
  {
    key: 'settingsPages',
    slot: 'settings-page',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, title: c.title, panel: c.panel })
  },
  {
    key: 'aiTools',
    slot: 'ai-tool',
    toContrib: (c, pluginId) => ({ pluginId, name: c.name, description: c.description, schema: c.schema })
  },
  {
    key: 'keyboardShortcuts',
    slot: 'keyboard-shortcut',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, defaultBinding: c.defaultBinding, description: c.description })
  },
  {
    key: 'statusBarItems',
    slot: 'status-bar-item',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, alignment: c.alignment })
  },
  {
    key: 'chatFilters',
    slot: 'chat-filter',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, label: c.label, icon: c.icon })
  },
  {
    key: 'chatSortStrategies',
    slot: 'chat-sort-strategy',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, label: c.label })
  },
  {
    key: 'completionProviders',
    slot: 'completion-provider',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, trigger: c.trigger, context: c.context })
  },
  {
    key: 'messageSendPipeline',
    slot: 'message-send-pipeline',
    toContrib: (c, pluginId) => ({ pluginId, id: c.id, priority: c.priority })
  },
  {
    key: 'pluginApiExports',
    slot: 'plugin-api-export',
    toContrib: (c, pluginId) => ({ pluginId, exportName: c })
  }
]

export type ContributionHandler = (...args: any[]) => Promise<unknown> | unknown

export class PluginHost implements IPluginHost {
  private builtinPlugins = new Map<string, IBuiltinPlugin>()
  private handlers = new Map<string, ContributionHandler>()

  constructor(
    private readonly loader: IPluginLoader,
    private readonly registry: IPluginRegistry,
    private readonly router: IKernelAPIRouter,
    private readonly contributionRegistry: IContributionRegistry
  ) {}

  async registerBuiltin(plugin: IBuiltinPlugin): Promise<void> {
    if (this.registry.get(plugin.id)) {
      return
    }

    const channel = new DirectPluginChannel()
    this.router.attachChannel(plugin.id, channel)

    const eventHandlers = new Map<string, Set<(payload: unknown) => void | Promise<void>>>()

    channel.onKernelRequest(async (req) => {
      if (req.type === 'kernel:events:emit') {
        const { event, payload } = (req.payload as { event: string; payload: unknown }) || {}
        const handlers = eventHandlers.get(event)
        if (handlers) {
          for (const h of handlers) {
            await h(payload)
          }
        }
        channel.sendResponseToPlugin({ id: req.id, ok: true, payload: null })
        return
      }

      const parts = req.type.split(':')
      const slot = parts.slice(2).join(':') as ContributionSlot
      const payload = req.payload as { id?: string; name?: string; context?: Record<string, unknown>; args?: Record<string, unknown> } | undefined
      const targetId = payload?.id || payload?.name || ''
      const key = `${plugin.id}:${slot}:${targetId}`
      const handler = this.handlers.get(key)
      let result: unknown
      if (handler) {
        if (slot === 'ai-tool' && payload?.args) {
          result = await (handler as (args: Record<string, unknown>) => Promise<unknown>)(payload.args)
        } else {
          result = await (handler as (payload: unknown) => Promise<unknown>)(payload)
        }
      }
      channel.sendResponseToPlugin({ id: req.id, ok: true, payload: result })
    })

    const request = async <T = unknown>(type: string, payload?: unknown): Promise<T> => {
      const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const res = await channel.requestFromPlugin({ id: reqId, type, payload })
      if (!res.ok) {
        throw new Error(res.error?.message || `Kernel request failed: ${type}`)
      }
      return res.payload as T
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
        getList: (page = 1, limit = 50) => request<PluginChatItem[]>('kernel:chats:getList', { page, limit }),
        getById: (jid: string) => request<PluginChatItem | null>('kernel:chats:getById', { jid }),
        getGroupParticipants: (jid: string) => request<PluginGroupParticipant[]>('kernel:chats:getGroupParticipants', { jid }),
        pin: (jid: string) => request<void>('kernel:chats:pin', { jid }),
        unpin: (jid: string) => request<void>('kernel:chats:unpin', { jid }),
        archive: (jid: string) => request<void>('kernel:chats:archive', { jid }),
        unarchive: (jid: string) => request<void>('kernel:chats:unarchive', { jid }),
        mute: (jid: string, durationMs: number) => request<void>('kernel:chats:mute', { jid, durationMs }),
        unmute: (jid: string) => request<void>('kernel:chats:unmute', { jid }),
        markRead: (jid: string) => request<void>('kernel:chats:markRead', { jid })
      },
      messages: {
        getMessages: (jid: string, page = 1, limit = 50) => request<PluginMessageItem[]>('kernel:messages:getMessages', { jid, page, limit }),
        getMessagesAroundId: (jid: string, messageId: string, lookBehind = 20) => request<PluginMessageItem[]>('kernel:messages:getMessagesAroundId', { jid, messageId, lookBehind }),
        send: (jid: string, text: string, options?: SendMessageOptions) => request<PluginMessageItem>('kernel:messages:send', { jid, text, options }),
        sendMedia: (jid: string, filePath: string, caption?: string, options?: SendMessageOptions) => request<PluginMessageItem>('kernel:messages:sendMedia', { jid, filePath, caption, options }),
        edit: (messageId: string, newText: string, jid?: string) => request<PluginMessageItem>('kernel:messages:edit', { messageId, newText, jid }),
        forward: (messageId: string, targetJids: string[], jid?: string) => request<{ success: boolean; detail: string; results: Array<{ jid: string; messageId: string }> }>('kernel:messages:forward', { messageId, targetJids, jid }),
        delete: (jid: string, messageId: string) => request<void>('kernel:messages:delete', { jid, messageId }),
        react: (jid: string, messageId: string, emoji: string) => request<void>('kernel:messages:react', { jid, messageId, emoji }),
        downloadMedia: (messageId: string) => request<{ success: boolean; localURI?: string; filePath?: string; message?: unknown }>('kernel:messages:downloadMedia', { messageId }),
        getReceipts: (messageId: string) => request<PluginReceiptItem[]>('kernel:messages:getReceipts', { messageId }),
        addFavoriteSticker: (messageId: string) => request<{ success: boolean }>('kernel:messages:addFavoriteSticker', { messageId }),
        getFavoriteStickers: () => request<PluginFavoriteStickerItem[]>('kernel:messages:getFavoriteStickers', {})
      },
      contacts: {
        getByJid: (jid: string) => request<PluginContactItem | null>('kernel:contacts:getByJid', { jid }),
        batchGetByJids: (jids: string[]) => request<PluginContactItem[]>('kernel:contacts:batchGetByJids', { jids }),
        getMe: () => request<PluginMeInfo>('kernel:contacts:getMe', {}),
        upsertContact: (contact: PluginContactInput) => request<{ success: boolean }>('kernel:contacts:upsertContact', { contact }),
        resolveLid: (jid: string) => request<{ jid: string; lid: string }>('kernel:contacts:resolveLid', { jid }),
        getAlias: (jid: string) => request<PluginAliasItem | null>('kernel:contacts:getAlias', { jid })
      },
      ai: {
        chat: (prompt: string, options?: AICallOptions) => request<string>('kernel:ai:chat', { prompt, options }),
        callTool: (toolName: string, args: Record<string, unknown>) => request<{ text: string }>('kernel:ai:callTool', { toolName, args }),
        getAvailableModels: () => request<PluginAIModelInfo[]>('kernel:ai:getAvailableModels', {}),
        createSession: (title: string, modelId?: string) => request<PluginAISession>('kernel:ai:createSession', { title, modelId }),
        listSessions: (page = 1, pageSize = 20) => request<PluginAISession[]>('kernel:ai:listSessions', { page, pageSize }),
        getSession: (id: string) => request<PluginAISession | null>('kernel:ai:getSession', { id }),
        renameSession: (id: string, title: string) => request<PluginAISession>('kernel:ai:renameSession', { id, title }),
        deleteSession: (id: string) => request<void>('kernel:ai:deleteSession', { id })
      },
      events: {
        on: (event: any, handler: (payload: any) => void | Promise<void>) => {
          const evt = String(event)
          if (!eventHandlers.has(evt)) {
            eventHandlers.set(evt, new Set())
            void request('kernel:events:subscribe', { event: evt }).catch((err) => {
              console.warn(`[Plugin:${plugin.id}] Failed to subscribe to event ${evt}:`, err)
            })
          }
          eventHandlers.get(evt)!.add(handler)

          return () => {
            const handlers = eventHandlers.get(evt)
            if (handlers) {
              handlers.delete(handler)
              if (handlers.size === 0) {
                eventHandlers.delete(evt)
                void request('kernel:events:unsubscribe', { event: evt }).catch((err) => {
                  console.warn(`[Plugin:${plugin.id}] Failed to unsubscribe from event ${evt}:`, err)
                })
              }
            }
          }
        }
      },
      ui: {
        notify: (opts: { title: string; body: string }) => request('kernel:ui:notify', opts) as Promise<void>,
        toast: (msg: string, level?: 'info' | 'success' | 'warning' | 'error') => void request('kernel:ui:toast', { message: msg, level }),
        showForm: <T extends Record<string, unknown> = Record<string, unknown>>(schema: any) =>
          request<T | null>('kernel:ui:showForm', schema),
        showConfirm: (opts: any) => request<boolean>('kernel:ui:showConfirm', opts),
        showAlert: (opts: any) => request<void>('kernel:ui:showAlert', opts)
      },
      storage: {
        get: (key: string) => request('kernel:storage:get', { key }) as Promise<any>,
        set: (key: string, value: unknown) => request('kernel:storage:set', { key, value }) as Promise<void>,
        delete: (key: string) => request('kernel:storage:delete', { key }) as Promise<void>,
        clear: () => request('kernel:storage:clear', {}) as Promise<void>,
        keys: () => request('kernel:storage:keys', {}) as Promise<string[]>
      },
      scheduler: {
        setInterval: (ms: number, fn: () => void | Promise<void>) => {
          const id = setInterval(fn, ms)
          return () => clearInterval(id)
        },
        setTimeout: (ms: number, fn: () => void | Promise<void>) => {
          const id = setTimeout(fn, ms)
          return () => clearInterval(id)
        },
        onCron: (name: string, fn: () => void | Promise<void>) => {
          const key = `cron:${name}`
          if (!eventHandlers.has(key)) {
            eventHandlers.set(key, new Set())
          }
          eventHandlers.get(key)!.add(fn)
        }
      },
      contributions: {
        registerChatAction: (id, handler) => {
          const decl = plugin.manifest.contributions.chatActions?.find((a) => a.id === id)
          this.contributionRegistry.register('chat-action', {
            pluginId: plugin.id,
            id,
            label: decl?.label ?? id,
            icon: decl?.icon,
            when: decl?.when,
            subMenu: decl?.subMenu
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
            when: decl?.when,
            subMenu: decl?.subMenu
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
      for (const mapping of MANIFEST_TO_SLOT_MAPPINGS) {
        const list = contribs[mapping.key]
        if (Array.isArray(list)) {
          for (const item of list) {
            this.contributionRegistry.register(
              mapping.slot,
              mapping.toContrib(item, id)
            )
          }
        }
      }
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
