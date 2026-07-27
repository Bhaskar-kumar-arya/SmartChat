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
import { WhatsappCorePlugin } from '../plugins/builtin/whatsapp-core'
import { AIAssistantPlugin } from '../plugins/builtin/ai-assistant'
import { SearchPlugin } from '../plugins/builtin/search'
import { NotificationsPlugin } from '../plugins/builtin/notifications'
import type { IWAEventBus } from '../services/whatsapp/IWAEventBus'
import type { SocketAccessor } from '../services/whatsapp/types'

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
      getUserDataPath
    )
    const loader = new PluginLoader(extensionsPath)
    const pluginRegistry = new PluginRegistry()

    const contactsModule = new KernelContactsModule(permissions, services.contactService)
    const aiModule = new KernelAIModule(permissions, services.aiService, services.toolRegistry)
    const eventsModule = new KernelEventsModule(
      permissions,
      () => getBus?.() ?? null,
      (pluginId) => pluginRegistry.get(pluginId)?.channel
    )
    const storageModule = new KernelStorageModule(permissions, storageRepo)
    const uiModule = new KernelUIModule(permissions, services.notificationService, getMainWindow)

    router.registerModule(chatsModule)
    router.registerModule(messagesModule)
    router.registerModule(contactsModule)
    router.registerModule(aiModule)
    router.registerModule(eventsModule)
    router.registerModule(storageModule)
    router.registerModule(uiModule)

    const host = new PluginHost(loader, pluginRegistry, router, registry)

    const builtins = [
      new WhatsappCorePlugin(),
      new AIAssistantPlugin(services.toolRegistry),
      new SearchPlugin(),
      new NotificationsPlugin()
    ]

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
      const loaded = host.listLoaded()
      for (const id of loaded) {
        await host.unload(id)
      }
    }

    return {
      host,
      loader,
      registry,
      router,
      permissions,
      dispose
    }
  }
}
