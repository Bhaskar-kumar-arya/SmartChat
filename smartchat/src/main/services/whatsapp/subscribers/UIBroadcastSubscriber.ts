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
import type { IWAEventBus } from '../IWAEventBus'
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
import type { IContactService } from '../../contacts/IContactService'
import type { IMessageQueryService } from '../../messages/IMessageQueryService'
import type { IMessageQueryRepository } from '../../messages/IMessageQueryRepository'
import { cleanJid } from '../../../utils'

export class UIBroadcastSubscriber implements IWAEventSubscriber {
  constructor(
    private contactService: IContactService,
    private messageQueryService: IMessageQueryService,
    private messageQueryRepository: IMessageQueryRepository,
    private getMainWindow: () => BrowserWindow | null
  ) {}

  register(bus: IWAEventBus): void {
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
      const nameMap = await this.contactService.batchResolveNames([participantOrChat], sock)
      const enriched = await this.messageQueryService.enrichMessage(processed, sock, nameMap)
      console.log('[UIBroadcastSubscriber] onIncoming message:', enriched.id, 'type:', enriched.messageType, 'chat:', enriched.chatJid)
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
      const dbMsg = await this.messageQueryRepository.findMessageById(event.messageId)
      if (!dbMsg) return
      const senderJid = cleanJid(dbMsg.participant || dbMsg.chatJid)
      const nameMap = await this.contactService.batchResolveNames([senderJid], event.sock)
      const enriched = await this.messageQueryService.enrichMessage(dbMsg, event.sock, nameMap)
      this.send('message-edited', enriched)
    } catch (err) {
      console.error('[UIBroadcastSubscriber] Error broadcasting message-edited:', err)
    }
  }

  private async onChatUpdated(event: ChatUpdatedEvent): Promise<void> {
    try {
      const sanitized = sanitizeIPCPayload(event.update) as Record<string, unknown>
      this.send('chat-updated', { jid: event.jid, ...sanitized })
    } catch (err) {
      console.error('[UIBroadcastSubscriber] Error serializing chat-updated event:', err)
    }
  }

  private async onPresence(event: PresenceEvent): Promise<void> {
    const win = this.window
    if (!win) return
    try {
      const { id, presences, sock } = event
      const cleanRemoteJid = cleanJid(id)
      const jids = Object.keys(presences).map(j => cleanJid(j))
      const nameMap = await this.contactService.batchResolveNames(jids, sock)

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
    console.log('[UIBroadcastSubscriber] onReactionProcessed:', event.id, 'type:', event.messageType, 'chat:', event.chatJid)
    this.send('new-message', event)
  }
}

/**
 * Safely sanitizes arbitrary payloads for Electron IPC serialization.
 * - Converts BigInt to string.
 * - Converts Baileys/Long objects to their string representation.
 * - Omit Buffer/Uint8Array to prevent massive binary transfer or serialization failure.
 * - Recursively processes arrays and plain objects.
 */
function sanitizeIPCPayload(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val
  }
  if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
    return val
  }
  if (typeof val === 'bigint') {
    return val.toString()
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeIPCPayload)
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    // Check if it is a Long-like object (Baileys Long format)
    if ('low' in obj && 'high' in obj && typeof obj.low === 'number' && typeof obj.high === 'number') {
      const low = obj.low
      const high = obj.high
      return (high * 4294967296 + (low >>> 0)).toString()
    }
    // Check for Buffer/Uint8Array
    if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
      return undefined
    }
    // Recursively clean plain objects
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || typeof v === 'function') {
        continue
      }
      const sanitized = sanitizeIPCPayload(v)
      if (sanitized !== undefined) {
        cleaned[k] = sanitized
      }
    }
    return cleaned
  }
  return undefined
}
