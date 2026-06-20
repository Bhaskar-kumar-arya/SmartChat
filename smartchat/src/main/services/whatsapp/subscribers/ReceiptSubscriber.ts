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

import type { IWAEventBus } from '../IWAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type {
  MessageStatusEvent,
  ReceiptEvent,
  ReactionEvent,
  CallEvent,
} from '../WAEventTypes'
import type { IReceiptService } from '../IReceiptService'
import type { IMessageProcessingService } from '../../messages/IMessageProcessingService'
import type { IContactService } from '../../contacts/IContactService'

export class ReceiptSubscriber implements IWAEventSubscriber {
  constructor(
    private receiptService: IReceiptService,
    private messageProcessingService: IMessageProcessingService,
    private contactService: IContactService
  ) {}

  register(bus: IWAEventBus): void {
    bus.on('message:status', this.onMessageStatus.bind(this))
    bus.on('receipt:update', this.onReceipt.bind(this))
    bus.on('reaction:update', this.onReaction.bind(this))
    bus.on('call:event',     this.onCall.bind(this))
  }

  dispose(): void {
    // Bus teardown handles listener removal
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private async onMessageStatus(event: MessageStatusEvent): Promise<void> {
    await this.receiptService
      .processMessageStatusUpdate(event.key, event.baileysStatus)
      .catch((err) => {
        console.error('[ReceiptSubscriber] Failed to process message status update:', err)
      })
  }

  private async onReceipt(event: ReceiptEvent): Promise<void> {
    for (const update of event.updates) {
      const { key, receipt } = update
      const type = receipt?.readTimestamp
        ? 'read'
        : receipt?.deliveredTimestamp
        ? 'delivered'
        : 'unknown'
      console.log(
        `[ReceiptSubscriber] ${type} | msgId=${key?.id} | chat=${key?.remoteJid} | by=${receipt?.userJid} | ts=${receipt?.readTimestamp ?? receipt?.deliveredTimestamp}`
      )
      await this.receiptService
        .processMessageReceipt(update, event.sock)
        .catch((err) => {
          console.error('[ReceiptSubscriber] Failed to process message receipt:', err)
        })
    }
  }

  private async onReaction(event: ReactionEvent): Promise<void> {
    for (const reactionUpdate of event.reactions) {
      await this.messageProcessingService
        .processReaction(reactionUpdate, event.sock)
        .catch((err) => {
          console.error('[ReceiptSubscriber] Error processing reaction:', err)
        })
    }
  }

  private async onCall(event: CallEvent): Promise<void> {
    for (const call of event.calls) {
      try {
        const fromJid = call.from
        const altPn = call.callerPn || call.content?.attrs?.['caller_pn'] || call.attrs?.['caller_pn']
        const altLid = call.content?.attrs?.['caller_lid'] || call.attrs?.['caller_lid']

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
          await this.contactService
            .linkLidAndPn(callLid, callPn, 'call.event')
            .catch((err) => {
               console.error('[ReceiptSubscriber] Failed to link LID and PN in call event:', err)
            })
        }
      } catch (err) {
        console.error('[ReceiptSubscriber] Error processing call event:', err)
      }
    }
  }
}
