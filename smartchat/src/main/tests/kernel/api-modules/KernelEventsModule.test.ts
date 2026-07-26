import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelEventsModule } from '../../../kernel/api-modules/KernelEventsModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'
import { IWAEventBus } from '../../../services/whatsapp/IWAEventBus'

describe('KernelEventsModule', () => {
  let mockPermissions: IPermissionStore
  let mockBus: IWAEventBus
  let module: KernelEventsModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn()
    }

    mockBus = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn()
    }

    module = new KernelEventsModule(mockPermissions, () => mockBus)
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:events')
  })

  it('denies subscribe when plugin lacks event permission', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })
    ).rejects.toEqual({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks permission for event 'message:incoming'",
      permission: 'events:message:incoming'
    })
  })

  it('allows subscribe when event permission is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = await module.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })

    expect(mockPermissions.hasCapability).toHaveBeenCalledWith('plugin-a', 'events:message:incoming')
    expect(mockBus.on).toHaveBeenCalledWith('message:incoming', expect.any(Function))
    expect(result).toEqual({ success: true, event: 'message:incoming' })
  })

  it('allows unsubscribe', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    await module.handle('plugin-a', 'kernel:events:subscribe', { event: 'message:incoming' })
    const result = await module.handle('plugin-a', 'kernel:events:unsubscribe', { event: 'message:incoming' })

    expect(mockBus.off).toHaveBeenCalledWith('message:incoming', expect.any(Function))
    expect(result).toEqual({ success: true, event: 'message:incoming' })
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:events:unknown', {})
    ).rejects.toEqual({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:events:unknown' in module 'kernel:events'"
    })
  })
})
