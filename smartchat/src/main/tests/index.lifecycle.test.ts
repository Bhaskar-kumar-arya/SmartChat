// H-05: characterization + fixes for the main-process window lifecycle in src/main/index.ts
// (B-APP-01 before-quit, B-APP-05 macOS activate, B-APP-06 null mainWindow on closed).
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (...args: unknown[]) => unknown
interface FakeWindow {
  handlers: Map<string, Handler>
  closed: boolean
  show: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
}

const h = vi.hoisted(() => {
  const state = {
    appHandlers: new Map<string, Handler[]>(),
    windows: [] as FakeWindow[],
    getMainWindow: null as null | (() => unknown),
    minimizeToTray: true
  }
  return state
})

vi.mock('electron', () => {
  class BrowserWindow {
    handlers = new Map<string, Handler>()
    closed = false
    show = vi.fn()
    hide = vi.fn()
    isMinimized = vi.fn(() => false)
    webContents = { setWindowOpenHandler: vi.fn(), send: vi.fn() }
    loadURL = vi.fn()
    loadFile = vi.fn()
    constructor() {
      h.windows.push(this)
    }
    on(evt: string, fn: Handler): void {
      this.handlers.set(evt, fn)
    }
    static getAllWindows(): FakeWindow[] {
      return h.windows.filter((w) => !w.closed)
    }
  }
  return {
    app: {
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      on: (evt: string, fn: Handler) => {
        h.appHandlers.set(evt, [...(h.appHandlers.get(evt) ?? []), fn])
      },
      quit: vi.fn(),
      exit: vi.fn(),
      isPackaged: false,
      getPath: () => '/tmp/smartchat-h05'
    },
    shell: { openExternal: vi.fn() },
    BrowserWindow,
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }
  }
})
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false }
}))
vi.mock('../../../resources/icon.png?asset', () => ({ default: 'icon' }))
vi.mock('../services/whatsapp/WhatsAppConnectionManager', () => ({
  WhatsAppConnectionManager: class {
    setWindow = vi.fn()
    connect = vi.fn(async () => {})
    onBusCreated = vi.fn()
    getBus = (): null => null
    getSocket = (): null => null
  }
}))
vi.mock('../services/whatsapp/WAEventBus', () => ({ WAEventBus: class {} }))
vi.mock('../auth', () => ({ prisma: {}, initVectorDb: vi.fn(async () => {}) }))
vi.mock('../ipcHandlers', () => ({ registerIpcHandlers: vi.fn() }))
vi.mock('../ServiceContainer', () => ({
  createServices: (_prisma: unknown, getMainWindow: () => unknown) => {
    h.getMainWindow = getMainWindow
    return {
      notificationService: { getPreferencesSync: () => ({ minimizeToTray: h.minimizeToTray }) },
      authSettingsService: {},
      messageRepository: { failStalePendingOutgoing: async () => 0 },
      chatRepository: {},
      dataWipeService: {},
      waWorkerBridge: {},
      vectorSyncService: {},
      toolRegistry: {},
      apiServer: { start: vi.fn() }
    }
  }
}))
vi.mock('../services/notification/TrayService', () => ({
  TrayService: class {
    init = vi.fn()
    destroy = vi.fn()
  }
}))
vi.mock('../services/protocol/SecureFileRegistry', () => ({
  SecureFileRegistry: class {
    registerDirectory = vi.fn()
  }
}))
vi.mock('../services/protocol/AppProtocolHandler', () => ({ AppProtocolHandler: class {} }))
vi.mock('../kernel/storage/PrismaPluginStorageRepository', () => ({
  PrismaPluginStorageRepository: class {}
}))
vi.mock('../kernel/KernelBootstrapper', () => ({
  KernelBootstrapper: class {
    boot = (): Promise<never> => new Promise(() => {})
  }
}))
vi.mock('../kernel/ipc/contributionIpc', () => ({ registerContributionIpcHandlers: vi.fn() }))
vi.mock('../protocol/pluginProtocol', () => ({ registerPluginProtocol: vi.fn() }))
vi.mock('../services/messages/StickerMetadataService', () => ({
  StickerMetadataService: { sweepTempDir: vi.fn() }
}))
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  const stub = { ...actual, appendFileSync: vi.fn(), mkdirSync: vi.fn() }
  return { ...stub, default: stub }
})

const emitApp = (evt: string, ...args: unknown[]): void =>
  (h.appHandlers.get(evt) ?? []).forEach((fn) => fn(...args))
const fireClose = (preventDefault: () => void): void => {
  h.windows[0].handlers.get('close')?.({ preventDefault })
}
const flush = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0))

describe('main index.ts window lifecycle (H-05)', () => {
  beforeEach(async () => {
    vi.resetModules()
    h.appHandlers.clear()
    h.windows.length = 0
    h.getMainWindow = null
    h.minimizeToTray = true
    await import('../index')
    await flush()
    await flush()
  })

  it('creates one window and hides it on close when minimizeToTray is on', () => {
    expect(h.windows).toHaveLength(1)
    const preventDefault = vi.fn()
    fireClose(preventDefault)
    expect(preventDefault).toHaveBeenCalled()
    expect(h.windows[0].hide).toHaveBeenCalled()
  })

  it('lets close through when minimizeToTray is off', () => {
    h.minimizeToTray = false
    const preventDefault = vi.fn()
    fireClose(preventDefault)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  // B-APP-01
  it('does not cancel window close once before-quit has fired (Cmd+Q / Dock quit / logout)', () => {
    emitApp('before-quit')
    const preventDefault = vi.fn()
    fireClose(preventDefault)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(h.windows[0].hide).not.toHaveBeenCalled()
  })

  // B-APP-05
  it('shows the hidden window on activate instead of doing nothing', () => {
    emitApp('activate')
    expect(h.windows).toHaveLength(1)
    expect(h.windows[0].show).toHaveBeenCalled()
  })

  it('recreates the window on activate when none are left', () => {
    h.windows[0].closed = true
    emitApp('activate')
    expect(h.windows).toHaveLength(2)
  })

  // B-APP-06
  it('nulls the main window reference when the window is closed', () => {
    expect(h.getMainWindow!()).toBe(h.windows[0])
    h.windows[0].handlers.get('closed')?.()
    expect(h.getMainWindow!()).toBeNull()
  })
})
