import { BrowserWindow } from 'electron'
import { IKernelModule } from './IKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { INotificationService } from '../../services/notification/INotificationService'

export class KernelUIModule implements IKernelModule {
  readonly namespace = 'kernel:ui'

  constructor(
    private readonly permissions: IPermissionStore,
    private readonly notificationService: INotificationService,
    private readonly getMainWindow?: () => BrowserWindow | null
  ) {}

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
        throw {
          code: 'NOT_FOUND',
          message: `Unknown action '${type}' in module '${this.namespace}'`
        }
    }
  }

  private extractAction(type: string): string {
    const parts = type.split(':')
    return parts.length > 2 ? parts.slice(2).join(':') : parts[1] || type
  }

  private requireCapability(pluginId: string, capability: string): void {
    if (!this.permissions.hasCapability(pluginId, capability)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Plugin '${pluginId}' lacks capability '${capability}'`,
        permission: capability
      }
    }
  }
}
