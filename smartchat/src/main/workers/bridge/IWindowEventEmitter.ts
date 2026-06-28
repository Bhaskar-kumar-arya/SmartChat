/**
 * Interface to abstract window event emitting from the bridge to the renderer.
 * Decouples the bridge layer from direct Electron/BrowserWindow imports.
 */
export interface IWindowEventEmitter {
  send(channel: string, data?: unknown): void
}
