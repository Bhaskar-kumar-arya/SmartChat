import { MessageItem, MessageType } from '../types/message.types'

/**
 * Generates a text preview representation of a message for the chat list sidebar.
 */
export function formatMessagePreview(msg: MessageItem): string {
  const type = msg.messageType as MessageType

  switch (type) {
    case 'stickerMessage':
    case 'lottieStickerMessage':
      return 'Sticker'
    case 'imageMessage':
      return msg.textContent || 'Photo'
    case 'videoMessage':
    case 'ptvMessage':
      return msg.textContent || 'Video'
    case 'documentMessage':
      return msg.textContent || 'Document'
    case 'audioMessage':
      return 'Voice message'
    case 'conversation':
    case 'extendedTextMessage':
      return msg.textContent || ''
    case 'templateMessage':
      return msg.textContent || 'Template message'
    case 'reactionMessage':
      return 'Reaction'
    case 'unknown':
      return msg.textContent || ''
    default: {
      // Exhaustiveness check
      const _exhaustiveCheck: never = type
      return msg.textContent || (type && type !== 'unknown' ? `[${_exhaustiveCheck}]` : '')
    }
  }
}
