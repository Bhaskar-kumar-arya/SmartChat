import { app, shell, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { WhatsAppConnectionManager } from './services/whatsapp/WhatsAppConnectionManager'
import { WAEventBus } from './services/whatsapp/WAEventBus'
import { prisma, initVectorDb } from './auth'
import { registerIpcHandlers } from './ipcHandlers'
import { createServices } from './ServiceContainer'
import { TrayService } from './services/notification/TrayService'

function getLogFile(): string {
  try {
    const logDir = app.isPackaged
      ? join(app.getPath('userData'), 'logs')
      : join(process.cwd(), 'dev_only', 'logs')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
    return join(logDir, 'main.log')
  } catch {
    return join(process.cwd(), 'main.log')
  }
}

function logMain(message: string, error?: unknown) {
  const timestamp = new Date().toISOString()
  const errorObj = error instanceof Error ? error : null
  const errorMsg = error ? ` | Error: ${errorObj?.message || String(error)}\n${errorObj?.stack || ''}` : ''
  const logLine = `[${timestamp}] ${message}${errorMsg}\n`
  console.log(message, error || '')
  try {
    fs.appendFileSync(getLogFile(), logLine, 'utf8')
  } catch (err) {
    console.error('[Main] Failed to write to main log file:', err)
  }
}

// Global Exception Handlers
process.on('uncaughtException', (error) => {
  logMain('Uncaught Exception in main process', error)
})

process.on('unhandledRejection', (reason) => {
  logMain('Unhandled Rejection in main process', reason)
})

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  logMain('[Main] Another instance is already running. Quitting.')
  app.quit()
} else {
  app.on('second-instance', () => {
    logMain('[Main] Second instance detected. Restoring and focusing main window.')
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Register 'app' protocol as privileged BEFORE app is ready
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }
  ])

  let mainWindow: BrowserWindow | null = null
let services: ReturnType<typeof createServices>
let waConnectionManager: WhatsAppConnectionManager
let trayService: TrayService | null = null
let isQuitting = false

const getSock = () => waConnectionManager?.getSocket() || null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      try {
        const prefs = services.notificationService.getPreferencesSync()
        if (prefs.minimizeToTray) {
          event.preventDefault()
          mainWindow?.hide()
          return
        }
      } catch (err) {
        console.error('Error in window close interceptor:', err)
      }
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) {
      const isAutoStart = process.argv.includes('--hidden')
      if (!isAutoStart) {
        mainWindow.show()
      } else {
        console.log('[Main] Started hidden via --hidden argument')
      }
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
  electronApp.setAppUserModelId('com.electron.smartchat')

  protocol.handle('app', async (request) => {
    try {
      const { host, pathname } = new URL(request.url)
      if (host === 'media') {
        const fileName = pathname.startsWith('/') ? pathname.slice(1) : pathname
        const filePath = join(app.getPath('userData'), 'media', fileName)
        
        if (fs.existsSync(filePath)) {
          return net.fetch(pathToFileURL(filePath).href)
        }
      } else if (host === 'favourites') {
        const fileName = pathname.startsWith('/') ? pathname.slice(1) : pathname
        const filePath = join(app.getPath('userData'), 'favourites', fileName)
        
        if (fs.existsSync(filePath)) {
          return net.fetch(pathToFileURL(filePath).href)
        }
      } else if (host === 'local') {
        const filePath = decodeURIComponent(pathname.startsWith('/') ? pathname.slice(1) : pathname)
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

  services = createServices(prisma, () => mainWindow, () => waConnectionManager?.getBus() ?? null)

  // Initialize Tray Service
  trayService = new TrayService(
    () => mainWindow,
    () => {
      isQuitting = true
      app.quit()
    }
  )
  trayService.init()

  waConnectionManager = new WhatsAppConnectionManager(
    services,
    services.authSettingsService,
    services.chatRepository,
    services.dataWipeService,
    services.historySyncManager,
    services.waEventWiringService,
    () => new WAEventBus(),
    services.socketFactory,
    services.catchUpManager
  )
  registerIpcHandlers(services, getSock, waConnectionManager)
  initVectorDb(services.vectorSyncService)

  ipcMain.on('wa-skip-sync', () => {
    waConnectionManager.skipSync()
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', async (e) => {
  // Prevent immediate quit to allow cleanup
  e.preventDefault();
  try {
    if (services?.aiService) {
      await services.aiService.cleanup();
    }
  } catch (err) {
    console.error('[App] Error during cleanup:', err);
  } finally {
    // Re-trigger quit now that cleanup is done
    app.exit(0);
  }
})

}
