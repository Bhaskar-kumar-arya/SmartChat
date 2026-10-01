/**
 * N-06 / R-KRN-01: shared kernel test harness.
 *
 * `createTestKernel()` wires the REAL kernel pieces (PluginLoader, PluginRegistry,
 * KernelAPIRouter, ContributionRegistry, PermissionStore, PluginHost, KernelUIModule,
 * PanelHost) against a temp plugin directory, with fake window / notification /
 * overlay / event-bus edges and in-memory storage.
 *
 * Real-worker fixture: every plugin Worker spawned through the harness loader is
 * tracked. `teardown()` unloads loaded plugins, destroys every tracked channel
 * (even ones that were never handed to the host, e.g. `loader.load()` called
 * directly) and AWAITS each worker's `exit` BEFORE deleting the temp directory.
 * Deleting the directory while a worker is still booting is what caused the
 * flaky unhandled "Cannot find module .../index.js" in panel-plugin.test.ts.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import type { Worker } from 'node:worker_threads'
import { PluginLoader } from '../../../kernel/plugins/PluginLoader'
import { PluginRegistry } from '../../../kernel/plugins/PluginRegistry'
import { PluginHost } from '../../../kernel/plugins/PluginHost'
import { KernelAPIRouter } from '../../../kernel/KernelAPIRouter'
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry'
import { PermissionStore } from '../../../kernel/permissions/PermissionStore'
import { KernelUIModule } from '../../../kernel/api-modules/KernelUIModule'
import type { IKernelModule } from '../../../kernel/api-modules/IKernelModule'
import { PanelHost } from '../../../kernel/ui/PanelHost'
import { OverlayHost } from '../../../kernel/ui/OverlayHost'
import type { IPluginChannel } from '../../../kernel/channels/IPluginChannel'

type Fn = ReturnType<typeof vi.fn>

export interface FakeWindow {
  webContents: { send: Fn }
  isDestroyed: () => boolean
}

export interface TestKernel {
  tmpDir: string
  loader: PluginLoader
  registry: PluginRegistry
  router: KernelAPIRouter
  contributions: ContributionRegistry
  permissions: PermissionStore
  host: PluginHost
  uiModule: KernelUIModule
  panelHost: PanelHost
  overlayHost: OverlayHost
  window: FakeWindow
  eventBus: { on: Fn; off: Fn; emit: Fn }
  notifications: {
    notify: Fn
    getPreferences: Fn
    getPreferencesSync: Fn
    setPreferences: Fn
    setActiveChat: Fn
  }
  /** Write `<tmpDir>/<id>/manifest.json` + entry file; returns the plugin dir. */
  writePlugin(opts: WritePluginOptions): string
  /** Real-worker fixture bookkeeping. */
  workers: TrackedWorkers
  /** Idempotent. Unload plugins, destroy channels, await worker exit, rm tmpDir. */
  teardown(): Promise<void>
}

export interface WritePluginOptions {
  id: string
  /** Raw manifest overrides (untyped on purpose: tests exercise legacy slot keys too). */
  manifest?: Record<string, unknown>
  /** Contents of the entry file. Defaults to {@link ackWorkerSource}. */
  source?: string
  /** Entry file name (default `index.js`, must match manifest.main). */
  main?: string
}

export interface CreateTestKernelOptions {
  /** Extra router modules; built after the defaults so they can use the context. */
  modules?: (k: Pick<TestKernel, 'permissions' | 'window' | 'eventBus' | 'notifications' | 'tmpDir'>) => IKernelModule[]
  /** Optional hook for loader errors etc. Not normally needed. */
  tmpPrefix?: string
}

/**
 * Minimal worker plugin: acknowledges `plugin:activate` / `plugin:deactivate`
 * (and anything else) over the real WorkerPluginChannel protocol, without the SDK.
 */
export const ackWorkerSource = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', (msg) => {
  if (msg && typeof msg.id === 'string' && typeof msg.type === 'string') {
    parentPort.postMessage({ id: msg.id, ok: true, payload: { echoed: msg.type, received: msg.payload } })
  }
})
`

export class TrackedWorkers {
  private entries: Array<{ channel: IPluginChannel; worker: Worker | null; exited: Promise<void> }> = []

  /** Number of workers ever spawned through the harness loader. */
  get spawned(): number {
    return this.entries.length
  }

  track(channel: IPluginChannel): void {
    const worker = ((channel as unknown as { worker?: Worker | null }).worker ?? null) as Worker | null
    const exited = worker
      ? new Promise<void>((resolve) => {
          worker.once('exit', () => resolve())
          // Never let a worker's late startup error surface as an unhandled
          // 'error' event while we are tearing down.
          worker.on('error', () => undefined)
        })
      : Promise.resolve()
    this.entries.push({ channel, worker, exited })
  }

  /** Destroy every tracked channel and wait until every worker thread has exited. */
  async destroyAll(): Promise<void> {
    for (const e of this.entries) {
      try {
        e.channel.destroy()
      } catch {
        /* best-effort */
      }
      // destroy() does not terminate a bare Worker when the channel has none; be explicit.
      if (e.worker) void e.worker.terminate().catch(() => undefined)
    }
    await Promise.all(this.entries.map((e) => e.exited))
    this.entries = []
  }
}

/** PluginLoader that records every channel (= real worker) it hands out. */
class TrackingPluginLoader extends PluginLoader {
  constructor(
    baseDir: string,
    private readonly workers: TrackedWorkers
  ) {
    super(baseDir)
  }

  override async load(id: string): ReturnType<PluginLoader['load']> {
    const res = await super.load(id)
    this.workers.track(res.channel)
    return res
  }
}

function rmWithRetry(dir: string): void {
  // Windows can briefly hold handles after a worker exits.
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      /* retry */
    }
  }
}

export function createTestKernel(opts: CreateTestKernelOptions = {}): TestKernel {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), opts.tmpPrefix ?? 'smartchat-test-kernel-'))
  const permissionsFile = path.join(tmpDir, 'permissions.json')
  fs.writeFileSync(permissionsFile, JSON.stringify({ plugins: {} }), 'utf8')
  // Plugins live in a subdir so permissions.json is never mistaken for one.
  const pluginsDir = path.join(tmpDir, 'plugins')

  const workers = new TrackedWorkers()
  const loader = new TrackingPluginLoader(pluginsDir, workers)
  const registry = new PluginRegistry()
  const router = new KernelAPIRouter()
  const contributions = new ContributionRegistry()
  const permissions = new PermissionStore(permissionsFile)

  const window: FakeWindow = { webContents: { send: vi.fn() }, isDestroyed: () => false }
  const eventBus = { on: vi.fn(), off: vi.fn(), emit: vi.fn() }
  const notifications = {
    notify: vi.fn(),
    getPreferences: vi.fn(),
    getPreferencesSync: vi.fn(),
    setPreferences: vi.fn(),
    setActiveChat: vi.fn()
  }

  const panelHost = new PanelHost(() => window as never)
  const overlayHost = new OverlayHost(() => window as never)
  const uiModule = new KernelUIModule(
    permissions,
    notifications as never,
    () => window as never,
    overlayHost,
    panelHost
  )
  router.registerModule(uiModule)

  const ctx = { permissions, window, eventBus, notifications, tmpDir }
  for (const m of opts.modules?.(ctx) ?? []) router.registerModule(m)

  const host = new PluginHost(loader, registry, router, contributions)

  let tornDown = false
  const kernel: TestKernel = {
    tmpDir,
    loader,
    registry,
    router,
    contributions,
    permissions,
    host,
    uiModule,
    panelHost,
    overlayHost,
    window,
    eventBus,
    notifications,
    workers,
    writePlugin({ id, manifest, source, main = 'index.js' }) {
      const dir = path.join(pluginsDir, id)
      fs.mkdirSync(dir, { recursive: true })
      const full = {
        apiVersion: '2',
        id,
        name: id,
        version: '1.0.0',
        main,
        permissions: [] as string[],
        contributions: {},
        ...manifest
      }
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(full), 'utf8')
      fs.writeFileSync(path.join(dir, main), source ?? ackWorkerSource, 'utf8')
      return dir
    },
    async teardown() {
      if (tornDown) return
      tornDown = true
      for (const id of host.listLoaded()) {
        try {
          await host.unload(id)
        } catch {
          /* best-effort */
        }
      }
      // Workers loaded outside the host (loader.load directly) and any survivors.
      await workers.destroyAll()
      rmWithRetry(tmpDir)
    }
  }
  return kernel
}
