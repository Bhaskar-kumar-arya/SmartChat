import { vi } from 'vitest'
import { ipcMainRecorder } from '../electron-mock'
import { registerIpcHandlers } from '../../ipcHandlers'
import { registerContributionIpcHandlers } from '../../kernel/ipc/contributionIpc'
import { registerOverlayIpcHandlers } from '../../kernel/ipc/overlayIpc'
import { registerPanelIpcHandlers } from '../../kernel/ipc/panelIpc'
import type { ServiceContainer } from '../../ServiceContainer'
import type { WASocket } from '../../services/whatsapp/types'
import type { WhatsAppConnectionManager } from '../../services/whatsapp/WhatsAppConnectionManager'
import type { ISecureFileRegistry } from '../../services/protocol/ISecureFileRegistry'

/**
 * A deep auto-stubbing object: any property is another stub, any call returns
 * `undefined`. Good enough for `register*Handlers()` functions that only touch
 * services lazily (inside handlers) plus a couple of registration-time calls.
 * Never thenable, so `await`ing it is safe.
 */
export function deepStub<T>(): T {
  const make = (): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => (prop === 'then' ? undefined : make()),
      apply: () => undefined
    })
  return make() as T
}

/** Event as Electron delivers it from the top-level app renderer (trusted). */
export const trustedEvent = {
  senderFrame: { parent: null, url: 'file:///app/out/renderer/index.html#/chats' },
  sender: { send: vi.fn() }
}

/** Event from a <webview> guest / sub-frame (must be rejected by guarded channels). */
export const untrustedEvent = {
  senderFrame: { parent: {}, url: 'https://evil.example/' },
  sender: { send: vi.fn() }
}

export interface RegisterAllOptions {
  /** Overrides for top-level services on the (otherwise deep-stubbed) ServiceContainer. */
  services?: Record<string, unknown>
  getSock?: () => WASocket | null
}

/**
 * Register app IPC handlers and the kernel IPC handlers (contribution, overlay,
 * panel) against the recording `ipcMain`. Returns the recorder for invoking them.
 */
export function registerAllIpc(options: RegisterAllOptions = {}): typeof ipcMainRecorder {
  ipcMainRecorder.reset()
  const base = deepStub<ServiceContainer>()
  const overrides = options.services ?? {}
  const services = new Proxy(base as object, {
    get: (target, prop, receiver) =>
      typeof prop === 'string' && prop in overrides
        ? overrides[prop]
        : Reflect.get(target, prop, receiver)
  }) as ServiceContainer

  registerIpcHandlers(
    services,
    options.getSock ?? (() => null),
    deepStub<WhatsAppConnectionManager>(),
    deepStub<ISecureFileRegistry>()
  )
  registerContributionIpcHandlers(
    { onChange: () => () => {} } as unknown as Parameters<typeof registerContributionIpcHandlers>[0],
    deepStub()
  )
  registerOverlayIpcHandlers(deepStub())
  registerPanelIpcHandlers(deepStub(), deepStub())
  return ipcMainRecorder
}
