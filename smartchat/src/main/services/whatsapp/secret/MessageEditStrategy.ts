import { proto, WASocket } from '@whiskeysockets/baileys'
import { PrismaClient } from '@prisma/client'
import { ISecretMessageStrategy, SecretMessageContext } from './ISecretMessageStrategy'
import { ProcessedMessage, ProtocolResult } from '../../../types'

export class MessageEditStrategy implements ISecretMessageStrategy {
  constructor(private prisma: PrismaClient) {}

  /**
   * Reads the original DB record and returns its parsed messageContextInfo,
   * which holds the messageSecret needed to decrypt future edits.
   */
  private async loadOriginalContextInfo(targetId: string): Promise<Record<string, any> | null> {
    try {
      const original = await this.prisma.message.findUnique({ where: { id: targetId } })
      if (original?.content) {
        const parsed = JSON.parse(original.content)
        return parsed.messageContextInfo ?? null
      }
    } catch {
      // Non-fatal — we simply won't be able to preserve the secret
    }
    return null
  }

  getSecretType(): number | string {
    // 2 corresponds to SecretEncType.MESSAGE_EDIT in proto.Message.SecretEncryptedMessage.SecretEncType
    return 2
  }

  getSigningLabel(): string {
    return 'Message Edit'
  }

  async handle(
    decryptedBytes: Uint8Array,
    context: SecretMessageContext,
    _sock: WASocket | null
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    const { targetId, remoteJid, fromMe } = context

    // Extract the edited content.
    // In WhatsApp protocol, the decrypted payload is either the edited message directly
    // or wrapped in a protocolMessage.
    const decryptedMessage = proto.Message.decode(decryptedBytes)
    let editedMsg: proto.IMessage = decryptedMessage
    if (decryptedMessage.protocolMessage?.editedMessage) {
      editedMsg = decryptedMessage.protocolMessage.editedMessage
    }

    const editContent =
      editedMsg.conversation ||
      editedMsg.extendedTextMessage?.text ||
      editedMsg.imageMessage?.caption ||
      editedMsg.videoMessage?.caption ||
      null

    try {
      // Preserve the original messageContextInfo so that subsequent edits
      // can still locate the messageSecret for decryption.
      const originalContextInfo = await this.loadOriginalContextInfo(targetId)
      const contentToStore = {
        ...(editedMsg || {}),
        ...(originalContextInfo ? { messageContextInfo: originalContextInfo } : {})
      }

      await this.prisma.message.update({
        where: { id: targetId },
        data: {
          content: JSON.stringify(contentToStore),
          textContent: editContent,
          isEdited: true
        }
      })

      return {
        type: 'protocol',
        subType: 'edit',
        targetId,
        key: {
          id: targetId,
          remoteJid,
          fromMe
        }
      }
    } catch (err) {
      console.error(`[MessageEditStrategy] Failed to update edited message ${targetId}:`, err)
      return null
    }
  }
}
