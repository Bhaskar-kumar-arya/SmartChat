import { MessageItem, MessageType } from '../types/message.types'

/**
 * Replaces `@<number>` with `@<name>` using the enriched `contextInfo.mentions`
 * map ({ jid: name }) in the message content. Returns the text unchanged when
 * there is no content, it is not JSON, or it carries no mention names.
 */
function withMentionNames(text: string | null | undefined, content: string | undefined): string {
  if (!text || !content || !text.includes('@')) return text || ''
  try {
    const body = Object.values(JSON.parse(content) as Record<string, unknown>).find(
      (v): v is { contextInfo?: { mentions?: Record<string, string> } } =>
        typeof v === 'object' && v !== null && 'contextInfo' in v
    )
    const mentions = body?.contextInfo?.mentions
    if (!mentions) return text
    let result = text
    for (const [jid, name] of Object.entries(mentions)) {
      const number = jid.split('@')[0]
      if (number && name) result = result.split(`@${number}`).join(`@${name}`)
    }
    return result
  } catch {
    return text
  }
}

/**
 * Generates a text preview representation of a message for the chat list sidebar.
 */
export function formatMessagePreview(msg: MessageItem): string {
  const type = msg.messageType as MessageType
  const text = withMentionNames(msg.textContent, msg.content)

  switch (type) {
    case 'stickerMessage':
    case 'lottieStickerMessage':
      return 'Sticker'
    case 'imageMessage':
      return text || 'Photo'
    case 'videoMessage':
    case 'ptvMessage':
      return text || 'Video'
    case 'documentMessage':
      return text || 'Document'
    case 'audioMessage':
      return 'Voice message'
    case 'conversation':
    case 'extendedTextMessage':
      return text
    case 'templateMessage':
      return text || 'Template message'
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
