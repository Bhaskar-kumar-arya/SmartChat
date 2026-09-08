import { app, BrowserWindow } from 'electron'
import { ServiceContainer } from '../ServiceContainer'
import { PermissionStore } from './permissions/PermissionStore'
import { ContributionRegistry } from './contributions/ContributionRegistry'
import { IContributionRegistry } from './contributions/IContributionRegistry'
import { KernelAPIRouter } from './KernelAPIRouter'
import { IKernelAPIRouter } from './IKernelAPIRouter'
import { PluginLoader } from './plugins/PluginLoader'
import { IPluginLoader } from './plugins/IPluginLoader'
import { PluginRegistry } from './plugins/PluginRegistry'
import { PluginHost } from './plugins/PluginHost'
import { IPluginHost } from './plugins/IPluginHost'
import { KernelChatsModule } from './api-modules/KernelChatsModule'
import { KernelMessagesModule } from './api-modules/KernelMessagesModule'
import { KernelContactsModule } from './api-modules/KernelContactsModule'
import { KernelAIModule } from './api-modules/KernelAIModule'
import { KernelEventsModule } from './api-modules/KernelEventsModule'
import { KernelStorageModule, IKernelStorageRepository } from './api-modules/KernelStorageModule'
import { KernelUIModule } from './api-modules/KernelUIModule'
import { KernelLogModule } from './api-modules/KernelLogModule'





import { OverlayHost } from './ui/OverlayHost'
import { registerOverlayIpcHandlers } from './ipc/overlayIpc'
import { PanelHost } from './ui/PanelHost'
import { registerPanelIpcHandlers } from './ipc/panelIpc'
import { WhatsappCorePlugin } from '../plugins/builtin/whatsapp-core'

import { AIAssistantPlugin } from '../plugins/builtin/ai-assistant'
import { NotificationsPlugin } from '../plugins/builtin/notifications'

import type { IWAEventBus } from '../services/whatsapp/IWAEventBus'
import type { SocketAccessor } from '../services/whatsapp/types'

import { registerPluginProtocol } from '../protocol/pluginProtocol'

export interface BootstrapperOptions {
  services: ServiceContainer
  getMainWindow?: () => BrowserWindow | null
  getBus?: () => IWAEventBus | null
  getSock?: SocketAccessor
  extensionsPath?: string
  permissionsFilePath?: string
  storageRepo?: IKernelStorageRepository
  getUserDataPath?: () => string
}

export interface BootResult {
  host: IPluginHost
  loader: IPluginLoader
  registry: IContributionRegistry
  router: IKernelAPIRouter
  permissions: PermissionStore
  panelHost: PanelHost
  eventsModule: KernelEventsModule
  /** Re-attach panel IPC event subscriptions to a freshly created WA bus (S9-01). */
  onBusConnected: (bus: IWAEventBus) => void
  dispose: () => Promise<void>
}


export class KernelBootstrapper {
  constructor(private readonly options: BootstrapperOptions) {}

  async boot(): Promise<BootResult> {
    const {
      services,
      getMainWindow,
      getBus,
      getSock,
      extensionsPath = 'userData/extensions',
      permissionsFilePath,
      storageRepo,
      getUserDataPath = () => (app ? app.getPath('userData') : '')
    } = this.options

    registerPluginProtocol(extensionsPath)

    const permissions = new PermissionStore(permissionsFilePath)
    const registry = new ContributionRegistry()
    const router = new KernelAPIRouter()

    const chatsModule = new KernelChatsModule(
      permissions,
      services.chatService,
      services.chatActionService,
      getSock
    )
    const messagesModule = new KernelMessagesModule(
      permissions,
      services.messageQueryService,
      services.messageActionService,
      getSock,
      services.mediaService,
      getUserDataPath,
      services.receiptService,
      services.favoriteStickerService,
      services.messageQueryRepository
    )
    const builtins = [
      new WhatsappCorePlugin(),
      new AIAssistantPlugin(services.toolRegistry),
      new NotificationsPlugin()
    ]
    const builtinIds = new Set<string>(builtins.map((p) => p.id))

    const loader = new PluginLoader(extensionsPath, (id) => builtinIds.has(id))
    const pluginRegistry = new PluginRegistry()

    const contactsModule = new KernelContactsModule(permissions, services.contactService, services.aliasRepository)
    const aiModule = new KernelAIModule(
      permissions,
      services.aiService,
      services.toolRegistry,
      (pluginId) => pluginRegistry.get(pluginId)?.channel,
      services.aiChatSessionService
    )
    const eventsModule = new KernelEventsModule(
      permissions,
      getBus ?? null,
      (pluginId) => pluginRegistry.get(pluginId)?.channel
    )
    const storageModule = new KernelStorageModule(permissions, storageRepo)
    const overlayHost = new OverlayHost(getMainWindow, (pluginId) => pluginRegistry.get(pluginId)?.channel)
    const unbindOverlayIpc = registerOverlayIpcHandlers(overlayHost)

    const panelHost = new PanelHost(getMainWindow)

    const panelIpc = registerPanelIpcHandlers(panelHost, router, getBus ?? null, permissions)
    const unbindPanelIpc = panelIpc.dispose

    const syncPanels = () => {
      for (const p of registry.getAll('sidebar-panel')) {
        if (p.panel) {
          panelHost.registerPanel({
            contributionId: p.id,
            pluginId: p.pluginId,
            panelPath: p.panel,
            type: 'sidebar'
          })
        }
      }
      for (const p of registry.getAll('settings-page')) {
        if (p.panel) {
          panelHost.registerPanel({
            contributionId: p.id,
            pluginId: p.pluginId,
            panelPath: p.panel,
            type: 'settings'
          })
        }
      }
    }

    registry.onChange(syncPanels)
    syncPanels()

    const uiModule = new KernelUIModule(
      permissions,
      services.notificationService,
      getMainWindow,
      overlayHost,
      panelHost
    )

    const logModule = new KernelLogModule(permissions)

    router.registerModule(chatsModule)
    router.registerModule(messagesModule)
    router.registerModule(contactsModule)
    router.registerModule(aiModule)
    router.registerModule(eventsModule)
    router.registerModule(storageModule)
    router.registerModule(uiModule)
    router.registerModule(logModule)


    const host = new PluginHost(loader, pluginRegistry, router, registry, (pluginId) => {
      // Kernel-side teardown when a plugin unloads: detach its WA event-bus
      // subscriptions (S8-06) and remove any AI tools it registered (S7-04).
      eventsModule.removePlugin(pluginId)
      aiModule.removePlugin(pluginId)
      // Drop the plugin's panel descriptors so stale panelIds stop resolving
      // and a reload with a changed panel path re-registers cleanly. (S9-06)
      panelHost.deregisterPlugin(pluginId)
    })

    for (const plugin of builtins) {
      permissions.registerPluginManifest(plugin.id, plugin.manifest.permissions)
      await host.registerBuiltin(plugin)
    }

    const installed = await loader.listInstalled()
    for (const manifest of installed) {
      permissions.registerPluginManifest(manifest.id, manifest.permissions)
      await host.load(manifest.id)
    }

    const dispose = async () => {
      unbindOverlayIpc()
      unbindPanelIpc()
      overlayHost.dispose()
      const loaded = host.listLoaded()
      for (const id of loaded) {
        // One plugin whose deactivate/teardown throws must not abort shutdown
        // for every plugin after it. (S8-03)
        await host.unload(id).catch((err) => {
          console.error(`[KernelBootstrapper] unload('${id}') failed during dispose:`, err)
        })
      }
    }


    return {
      host,
      loader,
      registry,
      router,
      permissions,
      panelHost,
      eventsModule,
      onBusConnected: panelIpc.onBusConnected,
      dispose
    }
  }
}

