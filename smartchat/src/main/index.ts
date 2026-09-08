import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'path'
import fs from 'fs'

// Register 'app' and 'plugin' protocols as privileged at the top level BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true, allowServiceWorkers: true } },
  { scheme: 'plugin', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true, allowServiceWorkers: true } }
])

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
import { PrismaPluginStorageRepository } from './kernel/storage/PrismaPluginStorageRepository'
import { KernelBootstrapper } from './kernel/KernelBootstrapper'
import { registerContributionIpcHandlers } from './kernel/ipc/contributionIpc'
import { registerPluginProtocol } from './protocol/pluginProtocol'
import { StickerMetadataService } from './services/messages/StickerMetadataService'
import type { IWAEventBus } from './services/whatsapp/IWAEventBus'

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

  let mainWindow: BrowserWindow | null = null
let services: ReturnType<typeof createServices>
let waConnectionManager: WhatsAppConnectionManager
let trayService: TrayService | null = null
let isQuitting = false

// The kernel events module only exists once bootstrapper.boot() resolves, but
// waConnectionManager.connect() (and its bus creation) can run first. Wire the
// onBusCreated callback synchronously and buffer the latest bus here until the
// module is ready, so cold-start plugin WhatsApp subscriptions are not lost. (S13-01)
let kernelEventsModule: { onBusConnected(bus: IWAEventBus): void } | null = null
// Panel IPC event subscriptions must also be re-attached to a fresh bus on every
// reconnect, or panel plugins stop receiving WhatsApp events. (S9-01)
let panelIpcOnBusConnected: ((bus: IWAEventBus) => void) | null = null
let bufferedWaBus: IWAEventBus | null = null
// Retained so `will-quit` can run the kernel teardown (unbind overlay/panel IPC,
// host.unload every plugin → plugin onDeactivate / storage flush). (S13-02)
let bootResultForShutdown: { dispose: () => Promise<void> } | null = null

const getSock = () => waConnectionManager?.getSocket() || null

let isWaConnected = false

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
      backgroundThrottling: false,
      webviewTag: true
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
      if (!isWaConnected) {
        isWaConnected = true
        waConnectionManager.connect().catch(err => console.error('[Main] Failed to connect WA manager:', err))
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = details.url
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!url.includes('localhost:') && !url.includes('127.0.0.1:')) {
        shell.openExternal(url)
      }
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron.smartchat')

  // Register plugin protocol handler BEFORE creating windows or loading webviews
  const extDir = join(app.getPath('userData'), 'extensions')
  registerPluginProtocol(extDir)

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

  app.on('web-contents-created', (_, contents) => {
    // Pin the security-relevant webPreferences of every <webview> guest before it
    // attaches, regardless of what the renderer put on the tag. (F9-04)
    contents.on('will-attach-webview', (_event, webPreferences, params) => {
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      delete (webPreferences as Record<string, unknown>).preloadURL
      // Only the app's own bundled preloads are allowed on a guest.
      const allowedPreloads = [
        join(__dirname, '../preload/panel-preload.js'),
        join(__dirname, '../preload/overlay-preload.js')
      ]
      if (params.preload && !allowedPreloads.includes(params.preload)) {
        console.warn('[Main] Stripped unexpected webview preload:', params.preload)
        delete (params as Record<string, unknown>).preload
      }
    })

    if (contents.getType() === 'webview') {
      // Lock plugin panel guests to their own plugin:// origin — block any
      // attempt to navigate the guest to remote / file: content while the panel
      // preload (IPC bridge) is still attached. (F9-04)
      const isAllowedGuestUrl = (url: string): boolean => {
        try {
          const u = new URL(url)
          if (u.protocol === 'plugin:') return true
          if (u.protocol === 'about:' || url === 'about:blank') return true
          if (is.dev && process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) {
            return true
          }
          return false
        } catch {
          return false
        }
      }
      contents.on('will-navigate', (event, url) => {
        if (!isAllowedGuestUrl(url)) {
          console.warn('[Main] Blocked webview navigation to', url)
          event.preventDefault()
        }
      })
      contents.on('will-redirect', (event, url) => {
        if (!isAllowedGuestUrl(url)) {
          console.warn('[Main] Blocked webview redirect to', url)
          event.preventDefault()
        }
      })

      contents.setWindowOpenHandler((details) => {
        const url = details.url
        if (url.startsWith('http://') || url.startsWith('https://')) {
          if (!url.includes('localhost:') && !url.includes('127.0.0.1:')) {
            shell.openExternal(url)
          }
        }
        return { action: 'deny' }
      })
    }
  })

  ipcMain.on('ping', () => console.log('pong'))

  // Reclaim temp sticker files leaked by sends that threw mid-processing. (P2-S2-08)
  StickerMetadataService.sweepTempDir()

  services = createServices(prisma, () => mainWindow, () => waConnectionManager?.getBus() ?? null, getSock)

  // Microkernel System Bootstrap
  const storageRepo = new PrismaPluginStorageRepository(prisma)
  const extensionsPath = join(app.getPath('userData'), 'extensions')
  const permissionsFilePath = join(app.getPath('userData'), 'plugin-permissions.json')

  const bootstrapper = new KernelBootstrapper({
    services,
    getMainWindow: () => mainWindow,
    getBus: () => waConnectionManager?.getBus() ?? null,
    getSock,
    extensionsPath,
    permissionsFilePath,
    storageRepo
  })

  bootstrapper.boot().then((bootResult) => {
    bootResultForShutdown = bootResult
    registerContributionIpcHandlers(bootResult.registry, bootResult.host, () => mainWindow?.webContents, bootResult.loader, bootResult.permissions, services.toolRegistry, bootResult.panelHost)
    // The onBusCreated callback is wired synchronously below (after
    // waConnectionManager is constructed). Now that the events module exists,
    // point the buffer at it and replay any bus that was created before boot
    // finished. (S13-01)
    kernelEventsModule = bootResult.eventsModule
    panelIpcOnBusConnected = bootResult.onBusConnected
    if (bufferedWaBus) {
      bootResult.eventsModule.onBusConnected(bufferedWaBus)
      bootResult.onBusConnected(bufferedWaBus)
      bufferedWaBus = null
    }
  }).catch((err) => logMain('[Main] Failed to boot microkernel', err))


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
  // Wire the WhatsApp bus → kernel events bridge synchronously, before
  // createWindow() → ready-to-show → connect() can create the first bus.
  // Buffers the bus if boot() has not resolved yet. (S13-01)
  waConnectionManager.onBusCreated((bus) => {
    if (kernelEventsModule) {
      kernelEventsModule.onBusConnected(bus)
      panelIpcOnBusConnected?.(bus)
    } else {
      bufferedWaBus = bus
    }
  })

  registerIpcHandlers(services, getSock, waConnectionManager, secureRegistry)
  // S13-04: await the vector-store barrier before starting the API server / deep
  // search path. `initVectorDb` catches internally and resolves (never rejects),
  // setting `vectorDbReady`, so a fresh/self-healing `vec_messages` table can't be
  // queried mid-CREATE by a `deepSearch` IPC or a parallel `VectorSyncService.sync`.
  await initVectorDb(services.vectorSyncService)

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
  // Bound the whole cleanup so a hung provider request / kept-alive socket can't
  // leave the process lingering with a hidden window + tray icon. (S13-08)
  const HARD_TIMEOUT_MS = 8000;
  const cleanup = (async () => {
    // Kernel teardown first: plugin onDeactivate / ctx.storage flush before the
    // worker threads it may talk to are stopped. (S13-02)
    if (bootResultForShutdown) {
      await bootResultForShutdown.dispose().catch(err => console.error('[App] Kernel dispose failed:', err));
    }
    if (waConnectionManager) {
      await waConnectionManager.shutdown().catch(err => console.error('[App] WA shutdown failed:', err));
    }
    if (services?.embeddingWorkerManager) {
      await services.embeddingWorkerManager.terminate().catch(err => console.error('[App] Embedding worker terminate failed:', err));
    }
    if (services?.apiServer) {
      await services.apiServer.stop().catch(err => console.error('[App] APIServer stop failed:', err));
    }
    if (services?.aiService) {
      await services.aiService.cleanup().catch((err: unknown) => console.error('[App] AI cleanup failed:', err));
    }
    try {
      trayService?.destroy();
    } catch (err) {
      console.error('[App] Tray destroy failed:', err);
    }
  })();

  try {
    await Promise.race([
      cleanup,
      new Promise((resolve) => setTimeout(resolve, HARD_TIMEOUT_MS))
    ]);
  } catch (err) {
    console.error('[App] Error during cleanup:', err);
  } finally {
    // Re-trigger quit now that cleanup is done
    app.exit(0);
  }
})


}
