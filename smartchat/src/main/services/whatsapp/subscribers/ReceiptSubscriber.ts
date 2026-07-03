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
  ReactionEvent
} from '../WAEventTypes'
import type { IReceiptService } from '../IReceiptService'
import type { IMessageProcessingService } from '../../messages/IMessageProcessingService'

export class ReceiptSubscriber implements IWAEventSubscriber {
  constructor(
    private receiptService: IReceiptService,
    private messageProcessingService: IMessageProcessingService
  ) {}

  register(bus: IWAEventBus): void {
    bus.on('message:status', this.onMessageStatus.bind(this))
    bus.on('receipt:update', this.onReceipt.bind(this))
    bus.on('reaction:update', this.onReaction.bind(this))
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


}
