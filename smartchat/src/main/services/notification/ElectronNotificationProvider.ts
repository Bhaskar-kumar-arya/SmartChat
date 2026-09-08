import { Notification } from 'electron'
import { INotificationProvider } from './INotificationProvider'

export class ElectronNotificationProvider implements INotificationProvider {
  name = 'electron'

  isSupported(): boolean {
    return Notification.isSupported()
  }

  send(
    title: string,
    body: string,
    options?: { silent?: boolean; icon?: string },
    onClick?: () => void
  ): void {
    const notification = new Notification({
      title,
      body,
      silent: options?.silent ?? false,
      icon: options?.icon
    })

    // P2-S11-07: previously each Notification was held in an `activeNotifications`
    // Set that was only pruned on the `click`/`close` events. On platforms where
    // the OS dismisses a notification without emitting `close` the entry (and its
    // retained onClick closure capturing getMainWindow) leaked forever. The Set
    // was never read, so it's gone — Electron/Chromium owns the notification
    // lifetime and GCs it once no listeners remain reachable.
    notification.on('click', () => {
      try {
        onClick?.()
      } catch (err) {
        console.error('Error in notification onClick:', err)
      }
    })

    notification.show()
  }
}
