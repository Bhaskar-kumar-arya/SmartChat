import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'path'

import fs from 'fs'
import { BaileysPatcher } from './services/whatsapp/BaileysPatcher'

// Apply all node_modules patches for Baileys library before anything else starts
BaileysPatcher.patch()

import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { WhatsAppConnectionManager } from './services/whatsapp/WhatsAppConnectionManager'
import { WAEventBus } from './services/whatsapp/WAEventBus'
import { prisma, initVectorDb } from './auth'
import { registerIpcHandlers } from './ipcHandlers'
import { createServices } from './ServiceContainer'
import { TrayService } from './services/notification/TrayService'
import { SecureFileRegistry } from './services/protocol/SecureFileRegistry'
import { AppProtocolHandler } from './services/protocol/AppProtocolHandler'
import { ExtensionLoader } from './extensions/host/ExtensionLoader'
import { ExtensionCapabilityRegistry } from './extensions/capabilities/ExtensionCapabilityRegistry'
import { LogCapabilityProvider } from './extensions/capabilities/providers/LogCapabilityProvider'
import { StorageCapabilityProvider } from './extensions/capabilities/providers/StorageCapabilityProvider'
import { EventCapabilityProvider } from './extensions/capabilities/providers/EventCapabilityProvider'
import { ExtensionStorageRepository } from './extensions/storage/ExtensionStorageRepository'
import { ExtensionEventBridge } from './extensions/events/ExtensionEventBridge'
import { ExtensionHost } from './extensions/host/ExtensionHost'
import { ExtensionSchedulerService } from './extensions/scheduler/ExtensionSchedulerService'
import { SchedulerCapabilityProvider } from './extensions/capabilities/providers/SchedulerCapabilityProvider'
import { ToolCapabilityProvider } from './extensions/capabilities/providers/ToolCapabilityProvider'

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
    { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }
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

  // Setup Secure Protocol Handler
  const secureRegistry = new SecureFileRegistry();
  secureRegistry.registerDirectory('media', join(app.getPath('userData'), 'media'));
  secureRegistry.registerDirectory('favourites', join(app.getPath('userData'), 'favourites'));
  // Note: 'local' directory access is intentionally removed to prevent Local File Inclusion (LFI) vulnerabilities.
  
  const protocolHandler = new AppProtocolHandler(
    secureRegistry, 
    process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173'
  );
  protocol.handle('app', (request) => protocolHandler.handleRequest(request));

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  services = createServices(prisma, () => mainWindow, () => waConnectionManager?.getBus() ?? null, getSock)

  // Extension System Bootstrap
  const extensionsPath = join(app.getPath('userData'), 'extensions')
  const extensionLoader = new ExtensionLoader(extensionsPath)
  const extensionRegistry = new ExtensionCapabilityRegistry()
  const eventBridge = new ExtensionEventBridge(() => waConnectionManager?.getBus() ?? null)
  const extensionSchedulerService = new ExtensionSchedulerService()
  const logProvider = new LogCapabilityProvider(extensionsPath)
  extensionRegistry.register('log', logProvider)
  extensionRegistry.register('storage', new StorageCapabilityProvider(new ExtensionStorageRepository(prisma)))
  extensionRegistry.register('events', new EventCapabilityProvider(eventBridge))
  extensionRegistry.register('scheduler', new SchedulerCapabilityProvider(extensionSchedulerService))
  extensionRegistry.register('tools', new ToolCapabilityProvider(services.toolRegistry, (extId) => logProvider.build({} as any, extId)))
  
  const extensionHost = new ExtensionHost(extensionLoader, extensionRegistry, extensionSchedulerService)
  extensionHost.loadAll().catch(err => logMain('[Main] Failed to load extensions', err))

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
    () => new WAEventBus(),
    services.waWorkerBridge
  )
  registerIpcHandlers(services, getSock, waConnectionManager)
  initVectorDb(services.vectorSyncService)

  try {
    services.apiServer.start()
  } catch (err) {
    console.error('[Main] Failed to start APIServer:', err)
  }

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
    if (services?.apiServer) {
      await services.apiServer.stop().catch(err => console.error('[App] APIServer stop failed:', err));
    }
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
