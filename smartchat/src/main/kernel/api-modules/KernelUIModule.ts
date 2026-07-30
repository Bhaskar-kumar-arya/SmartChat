import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { INotificationService } from '../../services/notification/INotificationService'
import { KernelNotFoundError } from './KernelErrors'
import { IOverlayHost, WebviewOverlayOptions } from '../ui/IOverlayHost'

export class KernelUIModule extends BaseKernelModule {
  readonly namespace = 'kernel:ui'

  constructor(
    permissions: IPermissionStore,
    private readonly notificationService: INotificationService,
    private readonly getMainWindow?: () => BrowserWindow | null,
    private readonly overlayHost?: IOverlayHost
  ) {
    super(permissions)
  }

  private getOverlayHost(): IOverlayHost {
    if (!this.overlayHost) {
      throw new Error('OverlayHost is not configured on KernelUIModule')
    }
    return this.overlayHost
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

      case 'showForm': {
        this.requireCapability(pluginId, 'ui:notification')
        const modalId = randomUUID()
        return await this.getOverlayHost().showModal({ type: 'form', modalId, payload })
      }

      case 'showConfirm': {
        this.requireCapability(pluginId, 'ui:notification')
        const modalId = randomUUID()
        return await this.getOverlayHost().showModal({ type: 'confirm', modalId, payload })
      }

      case 'showAlert': {
        this.requireCapability(pluginId, 'ui:notification')
        const modalId = randomUUID()
        await this.getOverlayHost().showModal({ type: 'alert', modalId, payload })
        return undefined
      }

      case 'showOverlay': {
        this.requireCapability(pluginId, 'ui:overlay')
        return await this.getOverlayHost().showOverlay(
          pluginId,
          payload as WebviewOverlayOptions
        )
      }

      case 'overlay:send': {
        const { overlayId, event, data } = (payload as { overlayId: string; event: string; data: unknown }) || {}
        this.getOverlayHost().sendToOverlay(overlayId, event, data)
        return { success: true }
      }

      case 'overlay:close': {
        const { overlayId } = (payload as { overlayId: string }) || {}
        this.getOverlayHost().closeOverlay(overlayId)
        return { success: true }
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }
}
