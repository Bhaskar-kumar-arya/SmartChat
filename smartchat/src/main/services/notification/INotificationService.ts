export interface NotificationOptions {
  chatJid: string
  chatName: string
  senderName?: string
  messageType?: string
  textContent?: string
  profilePicUrl?: string
}

export interface NotificationPreferences {
  enabled: boolean
  soundEnabled: boolean
  notifyWhenFocused: boolean
  minimizeToTray: boolean
}

export interface INotificationService {
  notify(options: NotificationOptions): void
  getPreferences(): Promise<NotificationPreferences>
  getPreferencesSync(): NotificationPreferences
  setPreferences(prefs: Partial<NotificationPreferences>): Promise<void>
  setActiveChat(jid: string | null): void
}
