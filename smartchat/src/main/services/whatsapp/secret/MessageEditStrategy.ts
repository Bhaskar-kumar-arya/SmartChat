import { proto, WASocket } from '@whiskeysockets/baileys'
import { ISecretMessageStrategy, SecretMessageContext } from './ISecretMessageStrategy'
import { ProcessedMessage } from '../../../domain/types'
import { ProtocolResult } from '../types'

export class MessageEditStrategy implements ISecretMessageStrategy {
  constructor() { }

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
    // WhatsApp delivers edits in several shapes. Unwrap them all:
    // 1. protocolMessage.editedMessage  (common for secretEncryptedMessage)
    // 2. top-level editedMessage.message (sometimes seen in older clients)
    // 3. the decoded message itself (direct conversation payload)
    let editedMsg: proto.IMessage = decryptedMessage
    if (decryptedMessage.protocolMessage?.editedMessage) {
      editedMsg = decryptedMessage.protocolMessage.editedMessage
    } else if ((decryptedMessage as any).editedMessage?.message) {
      editedMsg = (decryptedMessage as any).editedMessage.message
    } else if ((decryptedMessage as any).editedMessage) {
      editedMsg = (decryptedMessage as any).editedMessage
    }

    const editContent =
      editedMsg.conversation ||
      editedMsg.extendedTextMessage?.text ||
      editedMsg.imageMessage?.caption ||
      editedMsg.videoMessage?.caption ||
      null

    return {
      type: 'protocol',
      subType: 'edit',
      targetId,
      editedTextContent: editContent,
      editedContent: editedMsg,
      key: {
        id: targetId,
        remoteJid,
        fromMe
      }
    }
  }
}
