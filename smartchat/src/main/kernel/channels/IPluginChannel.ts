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
  onPluginRequest(handler: (msg: KernelRequest) => Promise<void>): void
  destroy(): void
}

export interface IBidirectionalPluginChannel extends IPluginChannel {
  sendRequestToPlugin(msg: KernelRequest): Promise<KernelResponse>
}

export function isBidirectionalPluginChannel(channel: IPluginChannel): channel is IBidirectionalPluginChannel {
  return 'sendRequestToPlugin' in channel && typeof (channel as IBidirectionalPluginChannel).sendRequestToPlugin === 'function'
}
