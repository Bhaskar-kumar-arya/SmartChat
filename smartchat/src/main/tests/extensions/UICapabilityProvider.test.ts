import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UICapabilityProvider } from '../../extensions/capabilities/providers/UICapabilityProvider'
import { ExtensionManifest } from '../../extensions/types/ExtensionManifest'

describe('UICapabilityProvider', () => {
  let mockNotificationService: any
  let mockGetMainWindow: any
  let mockWebContentsSend: any

  beforeEach(() => {
    mockNotificationService = {
      notify: vi.fn(),
      getPreferences: vi.fn(),
      getPreferencesSync: vi.fn(),
      setPreferences: vi.fn(),
      setActiveChat: vi.fn()
    }

    mockWebContentsSend = vi.fn()
    mockGetMainWindow = vi.fn().mockReturnValue({
      webContents: {
        send: mockWebContentsSend
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not inject UI API if permission is missing', () => {
    const provider = new UICapabilityProvider(mockNotificationService, mockGetMainWindow)
    const manifest = { permissions: [] } as unknown as ExtensionManifest
    const api = provider.build(manifest, 'test-ext')
    
    expect(api).toBeUndefined()
  })

  it('should notify via NotificationService', async () => {
    const provider = new UICapabilityProvider(mockNotificationService, mockGetMainWindow)
    const manifest = { permissions: ['ui:notification'] } as unknown as ExtensionManifest
    const api = provider.build(manifest, 'test-ext')
    
    expect(api).toBeDefined()
    
    await api!.notify({ title: 'Test', body: 'Extension loaded!' })
    
    expect(mockNotificationService.notify).toHaveBeenCalledWith({
      chatJid: 'extension:test-ext',
      chatName: 'Test',
      textContent: 'Extension loaded!',
      senderName: 'Extension'
    })
  })

  it('should toast via ipc:ui:toast', () => {
    const provider = new UICapabilityProvider(mockNotificationService, mockGetMainWindow)
    const manifest = { permissions: ['ui:notification'] } as unknown as ExtensionManifest
    const api = provider.build(manifest, 'test-ext')
    
    expect(api).toBeDefined()
    
    api!.toast('Hello from extension', 'success')
    
    expect(mockGetMainWindow).toHaveBeenCalled()
    expect(mockWebContentsSend).toHaveBeenCalledWith('ipc:ui:toast', {
      msg: 'Hello from extension',
      level: 'success',
      extensionId: 'test-ext'
    })
  })

  it('toast should gracefully handle null window', () => {
    const provider = new UICapabilityProvider(mockNotificationService, () => null)
    const manifest = { permissions: ['ui:notification'] } as unknown as ExtensionManifest
    const api = provider.build(manifest, 'test-ext')
    
    expect(api).toBeDefined()
    
    // Should not throw
    api!.toast('Hello', 'info')
  })
})
