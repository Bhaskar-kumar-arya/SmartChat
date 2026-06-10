/**
 * ReceiptSubscriber
 * =================
 * Listens to receipt, reaction, and call events.
 *
 * Delegates to existing ReceiptService for the heavy lifting.
 * Handles call events for LID↔PN linking (a contact-resolution concern
 * that piggbacks on call metadata).
 *
 * Single responsibility: message status tracking and call-event side-effects.
 */

import { BrowserWindow } from 'electron'
import type { WAEventBus } from '../WAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type {
  MessageStatusEvent,
  ReceiptEvent,
  ReactionEvent,
  CallEvent,
} from '../WAEventTypes'
import type { ServiceContainer } from '../../../ServiceContainer'

export class ReceiptSubscriber implements IWAEventSubscriber {
  constructor(
    private services: ServiceContainer,
    private getMainWindow: () => BrowserWindow | null
  ) {}

  register(bus: WAEventBus): void {
    bus.on('message:status', this.onMessageStatus.bind(this))
    bus.on('receipt:update', this.onReceipt.bind(this))
    bus.on('reaction:update', this.onReaction.bind(this))
    bus.on('call:event',     this.onCall.bind(this))
  }

  dispose(): void {
    // Bus teardown handles listener removal
  }

  private get window(): BrowserWindow | null {
    const w = this.getMainWindow()
    return w && !w.isDestroyed() ? w : null
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private async onMessageStatus(event: MessageStatusEvent): Promise<void> {
    await this.services.receiptService
      .processMessageStatusUpdate(event.key, event.baileysStatus, this.window)
      .catch(() => {})
  }

  private async onReceipt(event: ReceiptEvent): Promise<void> {
    for (const update of event.updates) {
      const { key, receipt } = update as any
      const type = receipt?.readTimestamp
        ? 'read'
        : receipt?.deliveredTimestamp
        ? 'delivered'
        : 'unknown'
      console.log(
        `[ReceiptSubscriber] ${type} | msgId=${key?.id} | chat=${key?.remoteJid} | by=${receipt?.userJid} | ts=${receipt?.readTimestamp ?? receipt?.deliveredTimestamp}`
      )
      await this.services.receiptService
        .processMessageReceipt(update, event.sock, this.window)
        .catch(() => {})
    }
  }

  private async onReaction(event: ReactionEvent): Promise<void> {
    for (const reactionUpdate of event.reactions) {
      await this.services.messageService
        .processReaction(reactionUpdate, event.sock, this.window)
        .catch((err) => {
          console.error('[ReceiptSubscriber] Error processing reaction:', err)
        })
    }
  }

  private async onCall(event: CallEvent): Promise<void> {
    for (const call of event.calls) {
      try {
        const rawCall = call as any
        const fromJid = rawCall.from
        const altPn = rawCall.callerPn || rawCall.content?.attrs?.['caller_pn'] || rawCall.attrs?.['caller_pn']
        const altLid = rawCall.content?.attrs?.['caller_lid'] || rawCall.attrs?.['caller_lid']

        const ids = [fromJid, altPn, altLid].filter(Boolean) as string[]
        let callLid: string | null = null
        let callPn: string | null = null

        for (const id of ids) {
          if (typeof id === 'string') {
            if (id.includes('@lid')) callLid = id
            if (id.includes('@s.whatsapp.net')) callPn = id
          }
        }

        if (callLid && callPn) {
          await this.services.contactService
            .linkLidAndPn(callLid, callPn, 'call.event')
            .catch(() => {})
        }
      } catch (err) {
        console.error('[ReceiptSubscriber] Error processing call event:', err)
      }
    }
  }
}
