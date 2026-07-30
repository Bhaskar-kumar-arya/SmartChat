export interface ModalRequest {
  type: 'form' | 'confirm' | 'alert'
  modalId: string
  payload: unknown
}

export interface WebviewOverlayOptions {
  panel: string
  context?: Record<string, unknown>
  width?: number
  height?: number
  title?: string
  mode?: 'promise' | 'handle'
}

export interface WebviewOverlayRequest extends WebviewOverlayOptions {
  overlayId: string
  pluginId: string
  mode: 'promise' | 'handle'
}

export interface IOverlayHost {
  showModal(req: ModalRequest): Promise<unknown>
  resolveModal(modalId: string, data: unknown): void

  showOverlay(pluginId: string, opts: WebviewOverlayOptions): Promise<unknown>
  sendToOverlay(overlayId: string, event: string, data: unknown): void
  closeOverlay(overlayId: string): void
  onOverlaySubmit(overlayId: string, data: unknown): void
  onOverlayEvent(overlayId: string, event: string, data: unknown): void
  onOverlayDismiss(overlayId: string): void
}
