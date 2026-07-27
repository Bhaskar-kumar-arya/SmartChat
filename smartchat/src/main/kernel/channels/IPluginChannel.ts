export interface KernelRequest {
  id: string
  type: string
  payload: unknown
}

export interface KernelResponse {
  id: string
  ok: boolean
  payload?: unknown
  error?: KernelErrorPayload
}

export interface KernelErrorPayload {
  code: KernelErrorCode
  message: string
  permission?: string
}

export type KernelErrorCode = string

export interface IPluginChannel {
  sendToPlugin(msg: KernelRequest): void
  sendResponseToPlugin(msg: KernelResponse): void
  sendRequestToPlugin?(msg: KernelRequest): Promise<KernelResponse>
  onPluginRequest(handler: (msg: KernelRequest) => Promise<void>): void
  destroy(): void
}
