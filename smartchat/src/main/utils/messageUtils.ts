import { MESSAGE_TYPE_LABELS } from '../constants'
import { proto } from '@whiskeysockets/baileys'

/**
 * Parses a Baileys-style timestamp (plain number or { low, high } Long object) to BigInt.
 * Safely handles null/undefined by returning BigInt(0).
 */
export function parseBaileysTimestamp(ts: unknown): bigint {
  if (ts === null || ts === undefined) return BigInt(0)
  if (typeof ts === 'object') {
    const obj = ts as Record<string, unknown>
    if ('low' in obj && 'high' in obj) {
      const low = BigInt((obj.low as number) >>> 0)
      const high = BigInt((obj.high as number) >>> 0)
      return (high << 32n) | low
    }
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
export function getMessageType(message: proto.IMessage | Record<string, unknown> | null | undefined): string {
  if (!message) return 'unknown'

  const rawMsg = message as Record<string, unknown>
  for (const key of MESSAGE_TYPE_PRIORITY_KEYS) {
    if (rawMsg[key] !== undefined && rawMsg[key] !== null) return key
  }

  // Dynamic fallback — scan remaining keys, skipping technical noise
  for (const key of Object.keys(rawMsg)) {
    if (!IGNORED_MESSAGE_KEYS.has(key) && rawMsg[key] !== undefined && rawMsg[key] !== null) {
      return key
    }
  }

  return 'unknown'
}

/**
 * Extracts plain text content from a raw Baileys message object for full-text search indexing.
 * Returns null when no text content can be found.
 */
export function extractTextContent(message: proto.IMessage | Record<string, unknown> | null | undefined): string | null {
  if (!message) return null

  const rawMsg = message as Record<string, unknown>
  if (typeof rawMsg.conversation === 'string') return rawMsg.conversation

  const extText = rawMsg.extendedTextMessage as Record<string, unknown> | undefined
  if (extText && typeof extText.text === 'string') return extText.text

  for (const key of ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'ptvMessage']) {
    const media = rawMsg[key] as Record<string, unknown> | undefined
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
export function unwrapMessage(msg: proto.IMessage | null | undefined): proto.IMessage {
  if (!msg) return {}
  const rawMsg = msg as Record<string, unknown>
  const outerContextInfo = (rawMsg.contextInfo as proto.IContextInfo | undefined) ||
    ((rawMsg.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo as proto.IContextInfo | undefined)

  let unwrapped: proto.IMessage = msg
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

  if (outerContextInfo) {
    const unwrappedRec = unwrapped as Record<string, unknown>
    const innerCtx = unwrappedRec.contextInfo || (unwrappedRec.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo
    if (!innerCtx) {
      if (unwrappedRec.extendedTextMessage && typeof unwrappedRec.extendedTextMessage === 'object') {
        (unwrappedRec.extendedTextMessage as Record<string, unknown>).contextInfo = outerContextInfo
      } else if (!unwrappedRec.contextInfo) {
        unwrappedRec.contextInfo = outerContextInfo
      }
    }
  }

  return unwrapped
}

/**
 * Safely extracts contextInfo (quoted message / reply context) from a raw or unwrapped message object.
 */
export function extractContextInfoFromContent(
  parsed: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== 'object') return null
  const unwrapped = unwrapMessage(parsed as any) as Record<string, unknown>
  if (!unwrapped || typeof unwrapped !== 'object') return null

  if (unwrapped.contextInfo && typeof unwrapped.contextInfo === 'object') {
    return unwrapped.contextInfo as Record<string, unknown>
  }
  for (const key of Object.keys(unwrapped)) {
    const inner = unwrapped[key]
    if (inner && typeof inner === 'object' && 'contextInfo' in inner) {
      const ci = (inner as Record<string, unknown>).contextInfo
      if (ci && typeof ci === 'object') {
        return ci as Record<string, unknown>
      }
    }
  }
  return null
}

/**
 * Preserves existing contextInfo when overwriting or editing message JSON content.
 */
export function preserveContextInfo(existingJson: string | null | undefined, newContent: string | null | undefined): string {
  if (!newContent) return newContent ?? ''
  if (!existingJson) return newContent
  try {
    const existingParsed = JSON.parse(existingJson) as Record<string, unknown>
    const existingContextInfo = extractContextInfoFromContent(existingParsed)

    if (!existingContextInfo) return newContent

    const newParsed = JSON.parse(newContent || '{}') as Record<string, unknown>
    const newContextInfo = extractContextInfoFromContent(newParsed)

    if (!newContextInfo || (!newContextInfo.quotedMessage && existingContextInfo.quotedMessage)) {
      const mergedContextInfo = {
        ...existingContextInfo,
        ...(newContextInfo || {})
      }
      if (newParsed.extendedTextMessage && typeof newParsed.extendedTextMessage === 'object') {
        (newParsed.extendedTextMessage as Record<string, unknown>).contextInfo = mergedContextInfo
      } else {
        const extText = (newParsed.extendedTextMessage as Record<string, unknown> | undefined) ?? {}
        const text = (newParsed.conversation as string) || (extText.text as string) || ''
        newParsed.extendedTextMessage = {
          ...extText,
          text,
          contextInfo: mergedContextInfo
        }
        delete newParsed.conversation
        delete newParsed.editedMessage
      }
      return JSON.stringify(newParsed)
    }
  } catch (e: unknown) {
    console.error('[messageUtils] Failed to preserve contextInfo:', e)
  }
  return newContent
}

/**
 * Preserves localURI on media messages when overwriting message JSON content.
 */
export function preserveLocalUri(existingJson: string | null | undefined, newContent: string | null | undefined): string {
  if (!newContent) return newContent ?? ''
  if (!existingJson) return newContent
  try {
    const existingParsed = JSON.parse(existingJson)
    const existingUnwrapped = unwrapMessage(existingParsed)
    const existingMedia = (
      existingUnwrapped?.imageMessage ??
      existingUnwrapped?.stickerMessage ??
      existingUnwrapped?.videoMessage ??
      existingUnwrapped?.documentMessage ??
      existingUnwrapped?.audioMessage
    ) as { localURI?: string } | undefined

    if (existingMedia?.localURI) {
      const currentParsed = JSON.parse(newContent)
      const currentUnwrapped = unwrapMessage(currentParsed)
      const currentMedia = (
        currentUnwrapped?.imageMessage ??
        currentUnwrapped?.stickerMessage ??
        currentUnwrapped?.videoMessage ??
        currentUnwrapped?.documentMessage ??
        currentUnwrapped?.audioMessage
      ) as { localURI?: string } | undefined
      if (currentMedia) {
        currentMedia.localURI = existingMedia.localURI
        return JSON.stringify(currentParsed)
      }
    }
  } catch (e: unknown) {
    console.error('[messageUtils] Failed to preserve localURI:', e)
  }
  return newContent
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
