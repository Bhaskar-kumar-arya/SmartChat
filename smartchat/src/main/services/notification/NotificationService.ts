import { app, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { INotificationService, NotificationOptions, NotificationPreferences } from './INotificationService'
import { INotificationProvider } from './INotificationProvider'
import { ElectronNotificationProvider } from './ElectronNotificationProvider'
import { unwrapMessage } from '../../utils/messageUtils'
import { MessageFormatterRegistry } from '../messages/formatters/MessageFormatterRegistry'
import { WAMessageContent } from '../whatsapp/types'

const preferencesPath = join(app.getPath('userData'), 'notification_preferences.json')

export class NotificationService implements INotificationService {
  private activeChatJid: string | null = null
  private provider: INotificationProvider
  // P2-S11-05: notifications fire on the message-receive hot path. Cache the
  // parsed prefs in memory instead of a synchronous stat+read+parse per
  // notification; this service is the only writer so the cache is invalidated
  // in writePreferences().
  private prefsCache: NotificationPreferences | null = null

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private readonly formatterRegistry: MessageFormatterRegistry
  ) {
    this.provider = new ElectronNotificationProvider()
    this.initPreferences()
  }

  private initPreferences(): void {
    if (!fs.existsSync(preferencesPath)) {
      // P2-S11-08: do NOT register a hidden auto-start OS entry at first launch
      // before the user has consented. `launchOnStartup` defaults to false; the
      // login-item is only registered once the user enables the toggle in
      // notification settings (setPreferences).
      const defaultPrefs: NotificationPreferences = {
        enabled: true,
        soundEnabled: true,
        notifyWhenFocused: false,
        minimizeToTray: true,
        launchOnStartup: false
      }
      this.writePreferences(defaultPrefs)
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

    let unwrapped: WAMessageContent | null = null
    if (options.content) {
      try {
        unwrapped = unwrapMessage(JSON.parse(options.content))
      } catch (err) {
        console.error('[NotificationService] Failed to parse message content:', err)
      }
    }

    const contentPreview = this.formatterRegistry.format(
      unwrapped as Record<string, any> | null | undefined,
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

    const sendNotification = (iconImage?: Electron.NativeImage) => {
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

  // P2-S11-06: profilePicUrl is attacker-influenceable (WhatsApp CDN data from
  // sync/enrichment). Restrict to https, bound the request with a timeout and a
  // byte cap, and cache the decoded icon so every notification isn't a fresh
  // network round-trip for an image that rarely changes.
  private static readonly ICON_FETCH_TIMEOUT_MS = 4000
  private static readonly ICON_MAX_BYTES = 2 * 1024 * 1024
  private iconCache = new Map<string, Electron.NativeImage | undefined>()

  private async getIconFromUrl(url: string): Promise<Electron.NativeImage | undefined> {
    if (this.iconCache.has(url)) return this.iconCache.get(url)

    let result: Electron.NativeImage | undefined
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') {
        console.warn('[NotificationService] Refusing non-https notification icon URL:', parsed.protocol)
      } else {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), NotificationService.ICON_FETCH_TIMEOUT_MS)
        try {
          const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
          if (response.ok) {
            const declared = Number(response.headers.get('content-length') || '0')
            if (declared && declared > NotificationService.ICON_MAX_BYTES) {
              console.warn('[NotificationService] Notification icon exceeds size cap, skipping')
            } else {
              const buffer = Buffer.from(await response.arrayBuffer())
              if (buffer.byteLength <= NotificationService.ICON_MAX_BYTES) {
                const img = nativeImage.createFromBuffer(buffer)
                if (!img.isEmpty()) result = img
              }
            }
          }
        } finally {
          clearTimeout(timer)
        }
      }
    } catch (e) {
      console.error('Failed to load notification icon from URL:', e)
    }

    // Cap the cache so a stream of unique (often already-expired) URLs can't
    // grow it without bound.
    if (this.iconCache.size > 200) this.iconCache.clear()
    this.iconCache.set(url, result)
    return result
  }



  private readPreferences(): NotificationPreferences {
    if (this.prefsCache) return this.prefsCache

    const defaultPrefs: NotificationPreferences = {
      enabled: true,
      soundEnabled: true,
      notifyWhenFocused: false,
      minimizeToTray: true,
      launchOnStartup: false
    }

    let prefs = defaultPrefs
    try {
      if (fs.existsSync(preferencesPath)) {
        const data = fs.readFileSync(preferencesPath, 'utf-8')
        prefs = { ...defaultPrefs, ...JSON.parse(data) }
      }
    } catch (e) {
      console.error('Failed to read notification preferences:', e)
    }
    this.prefsCache = prefs
    return prefs
  }

  private writePreferences(prefs: NotificationPreferences): void {
    // Update the cache first so readers see the new value even if the disk
    // write fails.
    this.prefsCache = prefs
    try {
      fs.writeFileSync(preferencesPath, JSON.stringify(prefs, null, 2))
    } catch (e) {
      console.error('Failed to write notification preferences:', e)
    }
  }
}
