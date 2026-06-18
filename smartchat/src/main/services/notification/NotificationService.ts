import { app, BrowserWindow, nativeImage } from 'electron'
import { proto } from '@whiskeysockets/baileys'
import { join } from 'path'
import fs from 'fs'
import { INotificationService, NotificationOptions, NotificationPreferences } from './INotificationService'
import { INotificationProvider } from './INotificationProvider'
import { ElectronNotificationProvider } from './ElectronNotificationProvider'
import { unwrapMessage } from '../../utils'
import { MessageFormatterRegistry } from '../messages/formatters/MessageFormatterRegistry'

const preferencesPath = join(app.getPath('userData'), 'notification_preferences.json')

export class NotificationService implements INotificationService {
  private activeChatJid: string | null = null
  private provider: INotificationProvider

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private readonly formatterRegistry: MessageFormatterRegistry
  ) {
    this.provider = new ElectronNotificationProvider()
    this.initPreferences()
  }

  private initPreferences(): void {
    if (!fs.existsSync(preferencesPath)) {
      const defaultPrefs: NotificationPreferences = {
        enabled: true,
        soundEnabled: true,
        notifyWhenFocused: false,
        minimizeToTray: true,
        launchOnStartup: true
      }
      this.writePreferences(defaultPrefs)
      if (app.isPackaged) {
        try {
          app.setLoginItemSettings({
            openAtLogin: true,
            path: app.getPath('exe'),
            args: ['--hidden']
          })
          console.log('[NotificationService] Default startup settings initialized: openAtLogin=true')
        } catch (err) {
          console.error('Failed to set initial startup settings:', err)
        }
      }
    }
  }

  setActiveChat(jid: string | null): void {
    this.activeChatJid = jid
  }

  async getPreferences(): Promise<NotificationPreferences> {
    return this.readPreferences()
  }

  getPreferencesSync(): NotificationPreferences {
    return this.readPreferences()
  }

  async setPreferences(prefs: Partial<NotificationPreferences>): Promise<void> {
    const current = this.readPreferences()
    const updated = { ...current, ...prefs }
    this.writePreferences(updated)

    if (prefs.launchOnStartup !== undefined && app.isPackaged) {
      try {
        app.setLoginItemSettings({
          openAtLogin: prefs.launchOnStartup,
          path: app.getPath('exe'),
          args: ['--hidden']
        })
        console.log(`[NotificationService] Startup entry set: openAtLogin=${prefs.launchOnStartup}`)
      } catch (err) {
        console.error('Failed to set login item settings:', err)
      }
    }
  }

  notify(options: NotificationOptions): void {
    const prefs = this.readPreferences()
    if (!prefs.enabled) {
      return
    }

    const mainWindow = this.getMainWindow()
    const isFocused = mainWindow?.isFocused() || false
    const isViewingThisChat = this.activeChatJid === options.chatJid

    // Rule 1: Always suppress if the user is actively focused on this exact chat
    if (isFocused && isViewingThisChat) {
      return
    }

    // Rule 2: Suppress if the app is focused elsewhere AND notifyWhenFocused is disabled
    if (isFocused && !isViewingThisChat && !prefs.notifyWhenFocused) {
      return
    }

    // Determine Title and Body based on Chat type (Group vs DM)
    const isGroup = options.chatJid.endsWith('@g.us')
    let title = ''
    let body = ''

    let unwrapped: proto.IMessage | null = null
    if (options.content) {
      try {
        unwrapped = unwrapMessage(JSON.parse(options.content))
      } catch (err) {
        console.error('[NotificationService] Failed to parse message content:', err)
      }
    }

    const contentPreview = this.formatterRegistry.format(
      unwrapped,
      {
        textContent: options.textContent,
        messageType: options.messageType || 'unknown',
        isDeleted: false
      },
      'notification'
    )

    if (isGroup) {
      title = options.chatName
      body = `${options.senderName || 'Someone'}: ${contentPreview}`
    } else {
      title = options.senderName || options.chatName || 'New Message'
      body = contentPreview
    }

    const sendNotification = (iconImage?: any) => {
      this.provider.send(
        title,
        body,
        { 
          silent: !prefs.soundEnabled,
          icon: iconImage
        },
        () => {
          // Notification click handler
          const win = this.getMainWindow()
          if (win) {
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
            win.webContents.send('open-chat', { jid: options.chatJid, name: options.chatName })
          }
        }
      )
    }

    if (options.profilePicUrl) {
      this.getIconFromUrl(options.profilePicUrl)
        .then((iconImage) => {
          sendNotification(iconImage)
        })
        .catch((err) => {
          console.error('Error fetching notification icon:', err)
          sendNotification()
        })
    } else {
      sendNotification()
    }
  }

  private async getIconFromUrl(url: string): Promise<any> {
    try {
      const response = await fetch(url)
      if (!response.ok) return undefined
      const buffer = Buffer.from(await response.arrayBuffer())
      return nativeImage.createFromBuffer(buffer)
    } catch (e) {
      console.error('Failed to load notification icon from URL:', e)
      return undefined
    }
  }



  private readPreferences(): NotificationPreferences {
    const defaultPrefs: NotificationPreferences = {
      enabled: true,
      soundEnabled: true,
      notifyWhenFocused: false,
      minimizeToTray: true,
      launchOnStartup: true
    }

    try {
      if (fs.existsSync(preferencesPath)) {
        const data = fs.readFileSync(preferencesPath, 'utf-8')
        return { ...defaultPrefs, ...JSON.parse(data) }
      }
    } catch (e) {
      console.error('Failed to read notification preferences:', e)
    }
    return defaultPrefs
  }

  private writePreferences(prefs: NotificationPreferences): void {
    try {
      fs.writeFileSync(preferencesPath, JSON.stringify(prefs, null, 2))
    } catch (e) {
      console.error('Failed to write notification preferences:', e)
    }
  }
}
