import { app, shell, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { waConnectionManager } from './services/WhatsAppConnectionManager'
import { prisma, initVectorDb } from './auth'
import { registerIpcHandlers } from './ipcHandlers'

// Register 'app' protocol as privileged BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }
])

// Module-level socket reference so IPC handlers can access it
const getSock = () => waConnectionManager.getSocket()

let mainWindow: BrowserWindow | null = null


function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show()
      waConnectionManager.setWindow(mainWindow)
      waConnectionManager.connect()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  protocol.handle('app', async (request) => {
    try {
      const { host, pathname } = new URL(request.url)
      if (host === 'media') {
        const fileName = pathname.startsWith('/') ? pathname.slice(1) : pathname
        const filePath = join(app.getPath('userData'), 'media', fileName)
        
        if (fs.existsSync(filePath)) {
          return net.fetch(pathToFileURL(filePath).href)
        }
      }
    } catch (err) {
      console.error('[Protocol] Error handling app:// request:', err)
    }
    return new Response('Not Found', { status: 404 })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  registerIpcHandlers(prisma, getSock)
  initVectorDb()

  ipcMain.on('wa-skip-sync', () => {
    waConnectionManager.skipSync()
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

import { aiService } from './services/AIService'

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', async (e) => {
  // Prevent immediate quit to allow cleanup
  e.preventDefault();
  try {
    await aiService.cleanup();
  } catch (err) {
    console.error('[App] Error during cleanup:', err);
  } finally {
    // Re-trigger quit now that cleanup is done
    app.exit(0);
  }
})
