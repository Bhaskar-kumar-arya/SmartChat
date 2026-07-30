import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KernelUIModule } from '../../../kernel/api-modules/KernelUIModule'
import { IPermissionStore } from '../../../kernel/permissions/IPermissionStore'
import { INotificationService } from '../../../services/notification/INotificationService'
import { IOverlayHost } from '../../../kernel/ui/IOverlayHost'

describe('KernelUIModule', () => {
  let mockPermissions: IPermissionStore
  let mockNotificationService: INotificationService
  let mockMainWindow: any
  let mockOverlayHost: IOverlayHost
  let module: KernelUIModule

  beforeEach(() => {
    mockPermissions = {
      hasCapability: vi.fn(),
      isResourceAllowed: vi.fn(),
      setCapability: vi.fn(),
      setScope: vi.fn(),
      getPluginPermissions: vi.fn(),
      registerPluginManifest: vi.fn()
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

    mockOverlayHost = {
      showModal: vi.fn(),
      resolveModal: vi.fn(),
      showOverlay: vi.fn(),
      sendToOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      onOverlaySubmit: vi.fn(),
      onOverlayEvent: vi.fn(),
      onOverlayDismiss: vi.fn()
    }

    module = new KernelUIModule(
      mockPermissions,
      mockNotificationService,
      () => mockMainWindow,
      mockOverlayHost
    )
  })

  it('has correct namespace', () => {
    expect(module.namespace).toBe('kernel:ui')
  })

  it('denies notify when ui:notification capability is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:ui:notify', { title: 'Alert', body: 'Message' })
    ).rejects.toMatchObject({
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
    ).rejects.toMatchObject({
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

  it('denies showForm when ui:notification capability is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:ui:showForm', { title: 'Test Form', fields: [] })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'ui:notification'"
    })
  })

  it('delegates showForm to overlayHost when capability is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockOverlayHost.showModal).mockResolvedValue({ name: 'SmartChat' })

    const schema = { title: 'Test Form', fields: [{ id: 'name', type: 'text', label: 'Name' }] }
    const result = await module.handle('plugin-a', 'kernel:ui:showForm', schema)

    expect(mockOverlayHost.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'form',
        payload: schema
      })
    )
    expect(result).toEqual({ name: 'SmartChat' })
  })

  it('delegates showConfirm to overlayHost when capability is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockOverlayHost.showModal).mockResolvedValue(true)

    const opts = { title: 'Are you sure?', body: 'Action cannot be undone' }
    const result = await module.handle('plugin-a', 'kernel:ui:showConfirm', opts)

    expect(mockOverlayHost.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirm',
        payload: opts
      })
    )
    expect(result).toBe(true)
  })

  it('delegates showAlert to overlayHost and resolves with undefined', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    vi.mocked(mockOverlayHost.showModal).mockResolvedValue(undefined)

    const opts = { title: 'Info', body: 'Operation complete' }
    const result = await module.handle('plugin-a', 'kernel:ui:showAlert', opts)

    expect(mockOverlayHost.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'alert',
        payload: opts
      })
    )
    expect(result).toBeUndefined()
  })

  it('denies showOverlay when ui:overlay capability is lacking', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(false)

    await expect(
      module.handle('plugin-a', 'kernel:ui:showOverlay', { panel: 'test.html' })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: "Plugin 'plugin-a' lacks capability 'ui:overlay'",
      permission: 'ui:overlay'
    })
  })

  it('allows showOverlay when ui:overlay is granted', async () => {
    vi.mocked(mockPermissions.hasCapability).mockReturnValue(true)
    mockOverlayHost.showOverlay = vi.fn().mockResolvedValue({ overlayId: 'ov-123' })

    const opts = { panel: 'test.html', mode: 'handle' as const }
    const result = await module.handle('plugin-a', 'kernel:ui:showOverlay', opts)

    expect(mockOverlayHost.showOverlay).toHaveBeenCalledWith('plugin-a', opts)
    expect(result).toEqual({ overlayId: 'ov-123' })
  })

  it('delegates overlay:send to overlayHost', async () => {
    mockOverlayHost.sendToOverlay = vi.fn()

    const result = await module.handle('plugin-a', 'kernel:ui:overlay:send', {
      overlayId: 'ov-1',
      event: 'results',
      data: [1, 2, 3]
    })

    expect(mockOverlayHost.sendToOverlay).toHaveBeenCalledWith('ov-1', 'results', [1, 2, 3])
    expect(result).toEqual({ success: true })
  })

  it('delegates overlay:close to overlayHost', async () => {
    mockOverlayHost.closeOverlay = vi.fn()

    const result = await module.handle('plugin-a', 'kernel:ui:overlay:close', {
      overlayId: 'ov-1'
    })

    expect(mockOverlayHost.closeOverlay).toHaveBeenCalledWith('ov-1')
    expect(result).toEqual({ success: true })
  })

  it('throws NOT_FOUND for unknown action type', async () => {
    await expect(
      module.handle('plugin-a', 'kernel:ui:unknown', {})
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Unknown action 'kernel:ui:unknown' in module 'kernel:ui'"
    })
  })
})

