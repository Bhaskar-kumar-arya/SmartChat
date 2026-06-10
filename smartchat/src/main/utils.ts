import { MESSAGE_TYPE_LABELS } from './constants'

/**
 * Cleans a WhatsApp JID by stripping any device/agent/port suffix (e.g. :1, :2, .0:1).
 * Example: "919606910020:2@s.whatsapp.net" -> "919606910020@s.whatsapp.net"
 *          "12345:1@lid" -> "12345@lid"
 *          "12036329439228@g.us" -> "12036329439228@g.us"
 */
export function cleanJid(jid: any): string {
  if (!jid || typeof jid !== 'string') return ''
  const parts = jid.split('@')
  if (parts.length < 2) return jid
  const base = parts[0].split(':')[0]
  const suffix = parts[1]
  return `${base}@${suffix}`
}

/**
 * Parses a Baileys-style timestamp (plain number or { low, high } Long object) to BigInt.
 * Safely handles null/undefined by returning BigInt(0).
 */
export function parseBaileysTimestamp(ts: unknown): bigint {
  if (ts === null || ts === undefined) return BigInt(0)
  if (typeof ts === 'object' && 'low' in (ts as Record<string, unknown>)) {
    return BigInt((ts as Record<string, unknown>).low as number)
  }
  return BigInt(ts as number)
}

/**
 * The priority-ordered list of recognised Baileys message type keys.
 * Shared between getMessageType() implementations to ensure consistent behaviour.
 */
const MESSAGE_TYPE_PRIORITY_KEYS = [
  'conversation',
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'ptvMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'lottieStickerMessage',
  'contactMessage',
  'locationMessage',
  'reactionMessage',
  'protocolMessage',
  'pollCreationMessage',
  'pollUpdateMessage',
  'liveLocationMessage',
  'senderKeyDistributionMessage'
] as const

/**
 * Technical keys that should be skipped when falling back to the dynamic key scan.
 */
const IGNORED_MESSAGE_KEYS = new Set(['contextInfo', 'messageContextInfo'])

/**
 * Determines the high-level message type from a Baileys proto.IMessage object.
 * Returns 'unknown' when the message is null/undefined or has no recognisable key.
 */
export function getMessageType(message: Record<string, unknown> | null | undefined): string {
  if (!message) return 'unknown'

  for (const key of MESSAGE_TYPE_PRIORITY_KEYS) {
    if (message[key] !== undefined && message[key] !== null) return key
  }

  // Dynamic fallback — scan remaining keys, skipping technical noise
  for (const key of Object.keys(message)) {
    if (!IGNORED_MESSAGE_KEYS.has(key) && message[key] !== undefined && message[key] !== null) {
      return key
    }
  }

  return 'unknown'
}

/**
 * Extracts plain text content from a raw Baileys message object for full-text search indexing.
 * Returns null when no text content can be found.
 */
export function extractTextContent(message: Record<string, unknown> | null | undefined): string | null {
  if (!message) return null

  if (typeof message.conversation === 'string') return message.conversation

  const extText = message.extendedTextMessage as Record<string, unknown> | undefined
  if (extText && typeof extText.text === 'string') return extText.text

  for (const key of ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'ptvMessage']) {
    const media = message[key] as Record<string, unknown> | undefined
    if (media && typeof media.caption === 'string') return media.caption
  }

  return null
}

/**
 * Unwraps special message containers (ephemeral, view-once, document-with-caption,
 * associated-child, edited).  Iterates up to 5 levels so deeply nested chains are
 * fully resolved — mirrors Baileys' own normalizeMessageContent behaviour, with the
 * additional handling of associatedChildMessage and editedMessage that Baileys misses.
 * Returns an empty object when msg is falsy.
 */
export function unwrapMessage(msg: any): any {
  if (!msg) return {}
  let unwrapped = msg
  for (let i = 0; i < 5; i++) {
    const next =
      unwrapped.ephemeralMessage?.message ||
      unwrapped.viewOnceMessage?.message ||
      unwrapped.viewOnceMessageV2?.message ||
      unwrapped.viewOnceMessageV2Extension?.message ||
      unwrapped.documentWithCaptionMessage?.message ||
      unwrapped.associatedChildMessage?.message ||
      unwrapped.lottieStickerMessage?.message ||
      unwrapped.editedMessage?.message
    if (!next) break
    unwrapped = next
  }
  return unwrapped
}

/**
 * Returns the last-message preview label for a given message type and optional text content.
 * Used in the chat list to display a short description of the last message.
 */
export function getMessagePreviewLabel(messageType: string | null, textContent: string | null): string {
  if (!messageType || messageType === 'unknown') return textContent || ''
  if (textContent) return textContent
  return MESSAGE_TYPE_LABELS[messageType] ?? messageType
}
