import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ipcMainRecorder } from '../electron-mock'
import { registerIpcHandlers } from '../../ipcHandlers'
import { deepStub, trustedEvent } from './ipcHarness'
import { WhatsAppConnectionManager } from '../../services/whatsapp/WhatsAppConnectionManager'
import type { ServiceContainer } from '../../ServiceContainer'
import type { ISecureFileRegistry } from '../../services/protocol/ISecureFileRegistry'

// F-WA-6 (B-WA-13): the skip-sync command's `{status}` ('success' | 'deferred' | 'error')
// must travel worker -> bridge -> connection manager -> `wa-skip-sync` (invoke) -> preload
// -> renderer service. The bridge leg is pinned in WAWorkerBridge.contract.test.ts.

const PRELOAD_DIR = join(__dirname, '../../../preload')
const preloadSrc = readFileSync(join(PRELOAD_DIR, 'index.ts'), 'utf8')
const preloadDts = readFileSync(join(PRELOAD_DIR, 'index.d.ts'), 'utf8')
const RENDERER_SVC = join(__dirname, '../../../renderer/src/services')
const iApiSrc = readFileSync(join(RENDERER_SVC, 'IAPIService.ts'), 'utf8')
const apiSvcSrc = readFileSync(join(RENDERER_SVC, 'api.service.ts'), 'utf8')

function makeManager(bridge: unknown): WhatsAppConnectionManager {
  const mgr = new WhatsAppConnectionManager(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    (() => ({ on: vi.fn(), removeAllListeners: vi.fn() })) as never,
    bridge as never
  )
  ;(mgr as unknown as { currentSock: unknown }).currentSock = bridge
  return mgr
}

describe('skip-sync status propagation (B-WA-13)', () => {
  it.fails("WhatsAppConnectionManager.skipSync resolves the bridge's {status:'deferred'}", async () => {
    const mgr = makeManager({ skipSync: vi.fn().mockResolvedValue({ status: 'deferred' }) })
    await expect(mgr.skipSync() as unknown as Promise<unknown>).resolves.toEqual({ status: 'deferred' })
  })

  it.fails("WhatsAppConnectionManager.skipSync resolves {status:'error'} when the command fails", async () => {
    const mgr = makeManager({ skipSync: vi.fn().mockRejectedValue(new Error('worker down')) })
    await expect(mgr.skipSync() as unknown as Promise<unknown>).resolves.toEqual({ status: 'error' })
  })

  it.fails("IPC wa-skip-sync is an invoke handler returning the manager's {status}", async () => {
    ipcMainRecorder.reset()
    const waConnectionManager = { skipSync: vi.fn().mockResolvedValue({ status: 'deferred' }) }
    registerIpcHandlers(
      deepStub<ServiceContainer>(),
      () => null,
      waConnectionManager as unknown as WhatsAppConnectionManager,
      deepStub<ISecureFileRegistry>()
    )
    await expect(ipcMainRecorder.invoke('wa-skip-sync', trustedEvent)).resolves.toEqual({ status: 'deferred' })
  })

  it.fails('preload invokes wa-skip-sync and every typing layer declares the {status} result', () => {
    const status = "Promise<{ status: 'success' | 'deferred' | 'error' }>"
    expect(preloadSrc).toMatch(/ipcRenderer\.invoke\('wa-skip-sync'\)/)
    expect(preloadDts).toContain(`skipSync: () => ${status}`)
    expect(iApiSrc).toContain(`skipSync(): ${status}`)
    expect(apiSvcSrc).toMatch(/skipSync: \(\)/)
  })
})
