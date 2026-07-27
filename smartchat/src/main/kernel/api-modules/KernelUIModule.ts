import { BrowserWindow } from 'electron'
import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { INotificationService } from '../../services/notification/INotificationService'
import { KernelNotFoundError } from './KernelErrors'

export class KernelUIModule extends BaseKernelModule {
  readonly namespace = 'kernel:ui'

  constructor(
    permissions: IPermissionStore,
    private readonly notificationService: INotificationService,
    private readonly getMainWindow?: () => BrowserWindow | null
  ) {
    super(permissions)
  }

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    const action = this.extractAction(type)

    switch (action) {
      case 'notify': {
        const { title, body } = payload as { title: string; body: string }
        this.requireCapability(pluginId, 'ui:notification')
        this.notificationService.notify({
          chatJid: `plugin:${pluginId}`,
          chatName: title,
          textContent: body
        })
        return { success: true }
      }

      case 'toast': {
        const { message, level = 'info' } = payload as { message: string; level?: 'info' | 'success' | 'warning' | 'error' }
        this.requireCapability(pluginId, 'ui:toast')
        const win = this.getMainWindow?.()
        if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())) {
          win.webContents.send('toast', { message, level, pluginId })
        }
        return { success: true }
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }
}
