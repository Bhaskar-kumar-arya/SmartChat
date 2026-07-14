import { join } from 'path'
import fs from 'fs'

export const app = {
  getPath: (name: string) => {
    if (name === 'userData') {
      const path = join(__dirname, '../../../../prisma/test-user-data')
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true })
      }
      return path
    }
    return ''
  },
  getAppPath: () => join(__dirname, '../../../..')
}

export class BrowserWindow {
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

export const ipcMain = {
  on: () => {},
  handle: () => {},
  handleOnce: () => {},
  removeHandler: () => {}
}

export const ipcRenderer = {
  on: () => {},
  send: () => {},
  invoke: async () => {}
}

export default {
  app,
  BrowserWindow,
  Notification,
  ipcMain,
  ipcRenderer
}
