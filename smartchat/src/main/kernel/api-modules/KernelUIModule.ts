import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'
import { INotificationService } from '../../services/notification/INotificationService'
import { KernelNotFoundError, KernelPermissionError } from './KernelErrors'
import { IOverlayHost, WebviewOverlayOptions } from '../ui/IOverlayHost'
import { IPanelHost } from '../ui/IPanelHost'

export class KernelUIModule extends BaseKernelModule {
  readonly namespace = 'kernel:ui'

  constructor(
    permissions: IPermissionStore,
    private readonly notificationService: INotificationService,
    private readonly getMainWindow?: () => BrowserWindow | null,
    private readonly overlayHost?: IOverlayHost,
    private readonly panelHost?: IPanelHost
  ) {
    super(permissions)
  }

  private getOverlayHost(): IOverlayHost {
    if (!this.overlayHost) {
      throw new Error('OverlayHost is not configured on KernelUIModule')
    }
    return this.overlayHost
  }

  private getPanelHost(): IPanelHost {
    if (!this.panelHost) {
      throw new Error('PanelHost is not configured on KernelUIModule')
    }
    return this.panelHost
  }

  /**
   * `overlay:send` / `overlay:close` route by a caller-supplied `overlayId`
   * only. Without an owner check any plugin could push spoofed events into — or
   * close — another plugin's overlay. (S7-05)
   */
  private requireOverlayOwnership(pluginId: string, overlayId: string): void {
    if (!overlayId || !this.getOverlayHost().isOverlayOwnedBy(overlayId, pluginId)) {
      throw new KernelPermissionError(
        `Plugin '${pluginId}' does not own overlay '${overlayId}'`,
        'ui:overlay'
      )
    }
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
        // Blocking modals that render plugin-supplied text/inputs in first-party
        // chrome are a materially higher-intrusion surface than a passive toast,
        // so they need their own capability rather than riding `ui:notification`. (S7-03)
        this.requireCapability(pluginId, 'ui:modal')
        const modalId = randomUUID()
        return await this.getOverlayHost().showModal({ type: 'form', modalId, payload })
      }

      case 'showConfirm': {
        this.requireCapability(pluginId, 'ui:modal')
        const modalId = randomUUID()
        return await this.getOverlayHost().showModal({ type: 'confirm', modalId, payload })
      }

      case 'showAlert': {
        this.requireCapability(pluginId, 'ui:modal')
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
        this.requireCapability(pluginId, 'ui:overlay')
        this.requireOverlayOwnership(pluginId, overlayId)
        this.getOverlayHost().sendToOverlay(overlayId, event, data)
        return { success: true }
      }

      case 'overlay:close': {
        const { overlayId } = (payload as { overlayId: string }) || {}
        this.requireCapability(pluginId, 'ui:overlay')
        this.requireOverlayOwnership(pluginId, overlayId)
        this.getOverlayHost().closeOverlay(overlayId)
        return { success: true }
      }

      case 'openPanel': {
        this.requireCapability(pluginId, 'ui:panel')
        const { id } = (payload as { id: string }) || {}
        return await this.getPanelHost().openPanel(pluginId, id)
      }

      case 'closePanel': {
        this.requireCapability(pluginId, 'ui:panel')
        const { id } = (payload as { id: string }) || {}
        return await this.getPanelHost().closePanel(pluginId, id)
      }

      default:
        throw new KernelNotFoundError(`Unknown action '${type}' in module '${this.namespace}'`)
    }
  }

}

