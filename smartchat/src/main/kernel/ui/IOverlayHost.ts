export interface ModalRequest {
  type: 'form' | 'confirm' | 'alert'
  modalId: string
  payload: unknown
}

export interface IOverlayHost {
  showModal(req: ModalRequest): Promise<unknown>
  resolveModal(modalId: string, data: unknown): void
}
