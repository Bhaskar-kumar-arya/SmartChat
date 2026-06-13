/**
 * UIBroadcastSubscriber
 * =====================
 * Listens to domain events and sends all IPC messages to the renderer process.
 *
 * Single responsibility: renderer IPC only.
 * This is the single point of contact between the main process event system
 * and the renderer window. Adding a second window, throttling, or batching
 * later only requires changes here.
 */

import { BrowserWindow } from 'electron'
import { PrismaClient } from '@prisma/client'
import type { WAEventBus } from '../WAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type {
  IncomingMessageEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  ChatUpdatedEvent,
  PresenceEvent,
  MessageStatusUpdatedEvent,
  ReactionProcessedEvent,
} from '../WAEventTypes'
import type { ServiceContainer } from '../../../ServiceContainer'
import { cleanJid } from '../../../utils'

export class UIBroadcastSubscriber implements IWAEventSubscriber {
  constructor(
    private services: ServiceContainer,
    private getMainWindow: () => BrowserWindow | null,
    private prisma: PrismaClient
  ) {}

  register(bus: WAEventBus): void {
    bus.on('message:incoming', this.onIncoming.bind(this))
    bus.on('message:deleted',  this.onDeleted.bind(this))
    bus.on('message:edited',   this.onEdited.bind(this))
    bus.on('chat:updated',     this.onChatUpdated.bind(this))
    bus.on('presence:update',  this.onPresence.bind(this))
    bus.on('message:status-updated', this.onStatusUpdated.bind(this))
    bus.on('reaction:processed', this.onReactionProcessed.bind(this))
  }

  dispose(): void {
    // Bus teardown handles listener removal
  }

  private get window(): BrowserWindow | null {
    const w = this.getMainWindow()
    return w && !w.isDestroyed() ? w : null
  }

  private send(channel: string, payload: unknown): void {
    this.window?.webContents.send(channel, payload)
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private async onIncoming(event: IncomingMessageEvent): Promise<void> {
    const win = this.window
    if (!win) return
    try {
      const { processed, sock } = event
      const participantOrChat = cleanJid(processed.participant || processed.chatJid)
      const nameMap = await this.services.contactService.batchResolveNames([participantOrChat], sock)
      const enriched = await this.services.messageService.enrichMessage(processed, sock, nameMap)
      this.send('new-message', enriched)
    } catch (err) {
      console.error('[UIBroadcastSubscriber] Error broadcasting new-message:', err)
    }
  }

  private async onDeleted(event: MessageDeletedEvent): Promise<void> {
    this.send('message-deleted', {
      id: event.messageId,
      chatJid: event.chatJid,
      fromMe: event.fromMe
    })
  }

  private async onEdited(event: MessageEditedEvent): Promise<void> {
    const win = this.window
    if (!win) return
    try {
      const dbMsg = await this.prisma.message.findUnique({ where: { id: event.messageId } })
      if (!dbMsg) return
      const senderJid = cleanJid(dbMsg.participant || dbMsg.chatJid)
      const nameMap = await this.services.contactService.batchResolveNames([senderJid], event.sock)
      const enriched = await this.services.messageService.enrichMessage(dbMsg, event.sock, nameMap)
      this.send('message-edited', enriched)
    } catch (err) {
      console.error('[UIBroadcastSubscriber] Error broadcasting message-edited:', err)
    }
  }

  private async onChatUpdated(event: ChatUpdatedEvent): Promise<void> {
    // Serialize BigInts before sending over IPC
    const formatted: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(event.update)) {
      formatted[key] = typeof val === 'bigint' ? val.toString() : val
    }
    this.send('chat-updated', { jid: event.jid, ...formatted })
  }

  private async onPresence(event: PresenceEvent): Promise<void> {
    const win = this.window
    if (!win) return
    try {
      const { id, presences, sock } = event
      const cleanRemoteJid = cleanJid(id)
      const jids = Object.keys(presences).map(j => cleanJid(j))
      const nameMap = await this.services.contactService.batchResolveNames(jids, sock)

      const enrichedPresences = Object.entries(presences).map(([participantJid, status]) => {
        const cleanParticipantJid = cleanJid(participantJid)
        const s = status as any
        return [
          cleanParticipantJid,
          {
            ...s,
            name: nameMap.get(cleanParticipantJid) || cleanParticipantJid.replace(/@.*$/, ''),
            lastSeen: s.lastSeen ? s.lastSeen.toString() : undefined,
            timestamp: Date.now()
          }
        ]
      })

      this.send('presence-update', {
        remoteJid: cleanRemoteJid,
        presences: Object.fromEntries(enrichedPresences)
      })
    } catch (err) {
      console.error('[UIBroadcastSubscriber] Error broadcasting presence update:', err)
    }
  }

  private async onStatusUpdated(event: MessageStatusUpdatedEvent): Promise<void> {
    this.send('message-status-updated', event)
  }

  private async onReactionProcessed(event: ReactionProcessedEvent): Promise<void> {
    this.send('new-message', event)
  }
}
