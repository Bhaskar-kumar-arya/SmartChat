import { proto, WASocket } from '@whiskeysockets/baileys'
import { ISecretMessageStrategy, SecretMessageContext } from './ISecretMessageStrategy'
import { ProcessedMessage } from '../../../domain/types'
import { ProtocolResult } from '../types'
import type { IWAEventBus } from '../IWAEventBus'

export class MessageReactionStrategy implements ISecretMessageStrategy {
  constructor(private getBus: () => IWAEventBus | null) {}

  getSecretType(): number | string {
    return 'encReactionMessage'
  }

  getSigningLabel(): string {
    return 'Enc Reaction'
  }

  async handle(
    decryptedBytes: Uint8Array,
    context: SecretMessageContext,
    sock: WASocket | null
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    const { targetId, remoteJid, fromMe, senderJid, timestamp } = context

    try {
      // Decode decryptedBytes using ReactionMessage schema
      const reaction = proto.Message.ReactionMessage.decode(decryptedBytes)
      
      const emoji = reaction.text || ''

      const bus = this.getBus()
      if (bus) {
        // Construct the reaction update structure that ReceiptSubscriber/MessageService expects
        const reactionUpdate = {
          key: {
            id: targetId,
            remoteJid,
            fromMe
          },
          reaction: {
            key: {
              id: targetId,
              remoteJid,
              fromMe,
              participant: senderJid
            },
            text: emoji,
            senderTimestampMs: Number(timestamp) * 1000
          }
        }

        // Emit reaction:update event so ReceiptSubscriber processes it normally
        await bus.emit('reaction:update', {
          reactions: [reactionUpdate],
          sock
        })
      }

      return null // Processed asynchronously via event bus flow
    } catch (err) {
      console.error(`[MessageReactionStrategy] Failed to process encrypted reaction for target ${targetId}:`, err)
      return null
    }
  }
}
