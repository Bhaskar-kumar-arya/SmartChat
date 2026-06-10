/**
 * NotificationSubscriber
 * ======================
 * Listens for incoming messages and triggers desktop notifications.
 *
 * Single responsibility: notification delivery only.
 * Skips fromMe messages, reactions, and history backlog (append type).
 */

import type { WAEventBus } from '../WAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type { IncomingMessageEvent } from '../WAEventTypes'
import type { ServiceContainer } from '../../../ServiceContainer'


export class NotificationSubscriber implements IWAEventSubscriber {
  private onIncomingMessageBound: (e: IncomingMessageEvent) => Promise<void>

  constructor(private services: ServiceContainer) {
    // Bind so we can remove the exact same reference in dispose()
    this.onIncomingMessageBound = this.onIncomingMessage.bind(this)
  }

  register(bus: WAEventBus): void {
    bus.on('message:incoming', this.onIncomingMessageBound)
  }

  dispose(): void {
    // Nothing to clean up — bus.removeAllListeners() handles this on teardown
  }

  private async onIncomingMessage(event: IncomingMessageEvent): Promise<void> {
    const { chatJid, senderJid, messageType, textContent, fromMe, sock } = event

    // Only notify for incoming, non-reaction messages
    if (fromMe || messageType === 'reactionMessage') return

    try {
      // Resolve sender display name
      const nameMap = await this.services.contactService.batchResolveNames([senderJid], sock)
      const senderName = nameMap.get(senderJid) || senderJid.split('@')[0]

      // Resolve chat display name via contactService
      let chatName = chatJid
      const chatNameMap = await this.services.contactService.batchResolveNames([chatJid], sock)
      chatName = chatNameMap.get(chatJid) || chatJid.split('@')[0]

      // Fetch profile picture (best-effort)
      let profilePicUrl: string | null = null
      try {
        const targetJid = chatJid.endsWith('@g.us') ? chatJid : senderJid
        profilePicUrl = await this.services.contactService.getProfilePicture(targetJid, 'preview', sock)
      } catch {
        // Non-fatal — notify without picture
      }

      this.services.notificationService.notify({
        chatJid,
        chatName,
        senderName,
        messageType,
        textContent: textContent || undefined,
        profilePicUrl: profilePicUrl || undefined
      })
    } catch (err) {
      console.error('[NotificationSubscriber] Error sending notification:', err)
    }
  }
}
