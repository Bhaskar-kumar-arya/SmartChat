import { join } from 'path'
import fs from 'fs'

export const app = {
  getPath: (name: string) => {
    if (name === 'userData') {
      const workerId = process.env.VITEST_WORKER_ID || process.pid.toString()
      const path = join(__dirname, `../../../prisma/test-user-data-${workerId}`)
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true })
      }
      return path
    }
    return ''
  },
  getAppPath: () => join(__dirname, '../../../..')
}

export const shell = {
  openPath: async (_path: string) => '',
  openExternal: async (_url: string) => {},
  showItemInFolder: (_path: string) => {}
}

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] { return [] }
  static getFocusedWindow(): BrowserWindow | null { return null }
  static fromWebContents(): BrowserWindow | null { return null }
  isDestroyed() { return false }
  isFocused() { return false }
  webContents = {
    send: () => {}
  }
}

export class Notification {
  static isSupported() { return true }
  constructor() {}
  show() {}
  on() {}
}

type IpcHandler = (...args: unknown[]) => unknown

// N-05: recording ipcMain. `handle`/`handleOnce` record invoke-style handlers,
// `on`/`once` record send-style listeners, both keyed by channel, so tests can
// run a `register*Handlers()` function and then call the handlers directly.
const invokeHandlers = new Map<string, IpcHandler>()
const sendListeners = new Map<string, IpcHandler[]>()

export const ipcMain = {
  handle: (channel: string, handler: IpcHandler) => {
    invokeHandlers.set(channel, handler)
  },
  handleOnce: (channel: string, handler: IpcHandler) => {
    invokeHandlers.set(channel, handler)
  },
  on: (channel: string, listener: IpcHandler) => {
    sendListeners.set(channel, [...(sendListeners.get(channel) ?? []), listener])
  },
  once: (channel: string, listener: IpcHandler) => {
    sendListeners.set(channel, [...(sendListeners.get(channel) ?? []), listener])
  },
  removeHandler: (channel: string) => {
    invokeHandlers.delete(channel)
  },
  removeListener: (channel: string, listener: IpcHandler) => {
    const rest = (sendListeners.get(channel) ?? []).filter(l => l !== listener)
    if (rest.length) sendListeners.set(channel, rest)
    else sendListeners.delete(channel)
  },
  removeAllListeners: (channel?: string) => {
    if (channel === undefined) sendListeners.clear()
    else sendListeners.delete(channel)
  }
}

/** Test helpers over the recording `ipcMain` (import from this file directly). */
export const ipcMainRecorder = {
  invokeChannels: (): string[] => [...invokeHandlers.keys()],
  sendChannels: (): string[] => [...sendListeners.keys()],
  getHandler: (channel: string): IpcHandler | undefined => invokeHandlers.get(channel),
  getListeners: (channel: string): IpcHandler[] => sendListeners.get(channel) ?? [],
  /** Invoke a registered `ipcMain.handle` handler as Electron would (event first). */
  invoke: async (channel: string, event: unknown, ...args: unknown[]): Promise<unknown> => {
    const handler = invokeHandlers.get(channel)
    if (!handler) throw new Error(`No ipcMain.handle registered for '${channel}'`)
    return handler(event, ...args)
  },
  reset: (): void => {
    invokeHandlers.clear()
    sendListeners.clear()
  }
}

export const ipcRenderer = {
  on: () => {},
  send: () => {},
  invoke: async () => {}
}

export default {
  app,
  shell,
  BrowserWindow,
  Notification,
  ipcMain,
  ipcRenderer
}
