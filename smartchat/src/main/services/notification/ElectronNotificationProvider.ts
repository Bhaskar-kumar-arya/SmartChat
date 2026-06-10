import { Notification } from 'electron'
import { INotificationProvider } from './INotificationProvider'

export class ElectronNotificationProvider implements INotificationProvider {
  name = 'electron'
  private activeNotifications = new Set<Notification>()

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

    this.activeNotifications.add(notification)

    notification.on('click', () => {
      try {
        if (onClick) {
          onClick()
        }
      } catch (err) {
        console.error('Error in notification onClick:', err)
      } finally {
        this.activeNotifications.delete(notification)
      }
    })

    notification.on('close', () => {
      this.activeNotifications.delete(notification)
    })

    notification.show()
  }
}
