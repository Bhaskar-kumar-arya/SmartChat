import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KernelLogModule } from '../../../kernel/api-modules/KernelLogModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'

describe('KernelLogModule', () => {
  let mockPermissions: IPermissionStore
  let module: KernelLogModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn(),
      registerPluginManifest: vi.fn()
    }
    module = new KernelLogModule(mockPermissions)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs a simple message', async () => {
    const result = await module.handle('plugin-a', 'kernel:log:info', { message: 'hello' })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('hello'))
    expect(result).toEqual({ success: true })
  })

  it('S7-04: truncates an oversized data blob instead of serialising it whole', async () => {
    const huge = 'x'.repeat(50000)
    await module.handle('plugin-a', 'kernel:log:info', { message: 'm', data: [huge] })

    const line = vi.mocked(console.log).mock.calls[0][0] as string
    expect(line.length).toBeLessThan(9000)
    expect(line).toContain('truncated')
  })

  it('S7-04: caps a giant message string', async () => {
    await module.handle('plugin-a', 'kernel:log:warn', { message: 'y'.repeat(50000) })
    const line = vi.mocked(console.warn).mock.calls[0][0] as string
    expect(line.length).toBeLessThan(9000)
  })

  it('S7-04: rate-limits a log flood from one plugin', async () => {
    let dropped = 0
    for (let i = 0; i < 250; i++) {
      const r = (await module.handle('plugin-a', 'kernel:log:info', { message: `${i}` })) as {
        success: boolean
        dropped?: string
      }
      if (!r.success) dropped++
    }
    expect(dropped).toBeGreaterThan(0)
  })
})
