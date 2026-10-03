export interface ModalRequest {
  type: 'form' | 'confirm' | 'alert'
  modalId: string
  /** Owning plugin; lets the host reject the modal when that plugin unloads. (F-KRN-3) */
  pluginId?: string
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
  /** True when `overlayId` is a live overlay created by `pluginId`. (S7-05) */
  isOverlayOwnedBy(overlayId: string, pluginId: string): boolean
  sendToOverlay(overlayId: string, event: string, data: unknown): void
  closeOverlay(overlayId: string): void
  onOverlaySubmit(overlayId: string, data: unknown): void
  onOverlayEvent(overlayId: string, event: string, data: unknown): void
  onOverlayDismiss(overlayId: string): void
  /** Close every overlay and reject every pending modal owned by `pluginId` (plugin unload). (F-KRN-3) */
  closeAllForPlugin?(pluginId: string): void
  /** Reject every outstanding modal/overlay promise on kernel teardown. (S9-05) */
  dispose?(): void
}
