import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelUIModule } from '../../../kernel/api-modules/KernelUIModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'
import { INotificationService } from '../../../services/notification/INotificationService'

describe('KernelUIModule', () => {
  let mockPermissions: IPermissionStore
  let mockNotificationService: INotificationService
  let mockMainWindow: any
  let module: KernelUIModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn()
    }

    mockNotificationService = {
      notify: vi.fn(),
      getPreferences: vi.fn(),
      getPreferencesSync: vi.fn(),
      setPreferences: vi.fn(),
      setActiveChat: vi.fn()
    }

    mockMainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn()
      }
    }

    module = new KernelUIModule(mockPermissions, mockNotificationService, () => mockMainWindow)
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:ui')
  })

  it('denies notify when ui:notification capability is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:ui:notify', { title: 'Alert', body: 'Message' })
    ).rejects.toEqual({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'ui:notification'",
      permission: 'ui:notification'
    })
  })

  it('allows notify when ui:notification is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = await module.handle('plugin-a', 'kernel:ui:notify', {
      title: 'Alert',
      body: 'Message'
    })

    expect(mockNotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ chatName: 'Alert', textContent: 'Message' })
    )
    expect(result).toEqual({ success: true })
  })

  it('denies toast when ui:toast capability is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:ui:toast', { message: 'Hello Toast', level: 'info' })
    ).rejects.toEqual({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'ui:toast'",
      permission: 'ui:toast'
    })
  })

  it('allows toast when ui:toast is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)

    const result = await module.handle('plugin-a', 'kernel:ui:toast', {
      message: 'Hello Toast',
      level: 'info'
    })

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('toast', {
      message: 'Hello Toast',
      level: 'info',
      pluginId: 'plugin-a'
    })
    expect(result).toEqual({ success: true })
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:ui:unknown', {})
    ).rejects.toEqual({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:ui:unknown' in module 'kernel:ui'"
    })
  })
})
