export interface IKernelModule {
  /** The prefix used for all request types this module handles, e.g. 'kernel:chats' */
  readonly namespace: string
  /** Dispatch a validated, permission-checked request and return a response payload. */
  handle(pluginId: string, type: string, payload: unknown): Promise<unknown>
}
