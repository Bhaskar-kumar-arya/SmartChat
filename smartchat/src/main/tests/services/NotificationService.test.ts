import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationService } from '../../services/notification/NotificationService'
import { MessageFormatterRegistry } from '../../services/messages/formatters/MessageFormatterRegistry'
import * as fs from 'fs'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    isPackaged: false,
    setLoginItemSettings: vi.fn()
  },
  BrowserWindow: vi.fn(),
  nativeImage: {
    createFromBuffer: vi.fn()
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))

vi.mock('../../services/notification/ElectronNotificationProvider', () => {
  return {
    ElectronNotificationProvider: class {
      send = vi.fn()
    }
  }
})

describe('NotificationService', () => {
  let service: NotificationService
  let getMainWindow: import('vitest').Mock
  let registry: import('vitest').Mocked<MessageFormatterRegistry>

  beforeEach(() => {
    getMainWindow = vi.fn().mockReturnValue({
      isFocused: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() }
    })

    registry = {
      format: vi.fn().mockReturnValue('Mocked Preview Text')
    } as any

    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(false)
    service = new NotificationService(getMainWindow, registry)
  })

  it('initializes default preferences if file does not exist', () => {
    expect(fs.writeFileSync).toHaveBeenCalled()
    const writeArgs = vi.mocked(fs.writeFileSync).mock.calls[0]
    expect(writeArgs[0]).toContain('notification_preferences.json')
    expect(writeArgs[1]).toContain('"enabled": true')
  })

  it('does not notify if notifications are disabled', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ enabled: false }))
    
    // We recreate the service to read the mocked file
    service = new NotificationService(getMainWindow, registry)
    service.notify({ chatJid: 'c1', chatName: 'Chat', messageType: 'conversation' })
    
    // Check provider is not called
    const providerInstance = (service as any).provider
    expect(providerInstance.send).not.toHaveBeenCalled()
  })

  it('notifies for group message with correct title and body', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ enabled: true, soundEnabled: true }))
    
    service = new NotificationService(getMainWindow, registry)
    service.notify({ 
      chatJid: '123@g.us', 
      chatName: 'My Group', 
      senderName: 'Alice',
      messageType: 'conversation' 
    })
    
    const providerInstance = (service as any).provider
    expect(providerInstance.send).toHaveBeenCalledWith(
      'My Group',
      'Alice: Mocked Preview Text',
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('suppresses notification if user is actively focused on the chat', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ enabled: true }))
    
    getMainWindow.mockReturnValue({
      isFocused: vi.fn().mockReturnValue(true)
    })
    
    service = new NotificationService(getMainWindow, registry)
    service.setActiveChat('c1@s.whatsapp.net')
    
    service.notify({ chatJid: 'c1@s.whatsapp.net', chatName: 'Chat', messageType: 'conversation' })
    
    const providerInstance = (service as any).provider
    expect(providerInstance.send).not.toHaveBeenCalled()
  })
})
