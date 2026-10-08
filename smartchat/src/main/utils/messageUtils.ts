import { MESSAGE_TYPE_LABELS, PROTOCOL_TYPE_REVOKE, PROTOCOL_TYPE_EDIT } from '../constants'
import { proto, WAMessageStubType } from '@whiskeysockets/baileys'

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
 * Normalize a WhatsApp mute-expiration value to **seconds**.
 *
 * WhatsApp/Baileys sometimes deliver the mute expiration in milliseconds
 * (history/hydration payloads) and sometimes in seconds. `ChatService.isChatMuted`
 * interprets the stored value as seconds, so every write path must funnel through
 * this helper to avoid a group being treated as muted ~1000× further into the
 * future than intended. The sentinel `-1` ("muted forever") is passed through
 * untouched. (P2-S4-02)
 */
export function normalizeMuteExpirationSeconds(raw: unknown): bigint {
  if (raw === null || raw === undefined) return 0n
  let val: bigint
  if (typeof raw === 'bigint') {
    val = raw
  } else if (typeof raw === 'number' || typeof raw === 'string') {
    val = BigInt(Math.trunc(Number(raw)) || 0)
  } else if (typeof raw === 'object' && raw !== null && 'low' in (raw as Record<string, unknown>)) {
    // Baileys Long-like { low, high }
    val = parseBaileysTimestamp(raw)
  } else {
    return 0n
  }
  if (val === -1n) return -1n
  // Anything above ~Sat 2286 in seconds is really milliseconds.
  return val > 10000000000n ? val / 1000n : val
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

const CAPTION_MEDIA_KEYS = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'ptvMessage'] as const

export interface ExtractTextOptions {
  /**
   * `MessageParser` semantics: an empty `extendedTextMessage.text` falls through, and only the
   * FIRST media object present is consulted for a caption. The default (index/sync/decrypt)
   * semantics accept an empty text and scan every media key. The two disagree on those edge
   * cases; each caller keeps its historical behaviour (R-MSG-08).
   */
  parserSemantics?: boolean
}

/**
 * Extracts plain text content from a (already unwrapped) Baileys message object: conversation,
 * extended text, or media caption. Returns null when no text content can be found.
 */
export function extractTextContent(
  message: proto.IMessage | Record<string, unknown> | null | undefined,
  options?: ExtractTextOptions
): string | null {
  if (!message) return null

  const rawMsg = message as Record<string, unknown>
  if (typeof rawMsg.conversation === 'string') return rawMsg.conversation

  const extText = rawMsg.extendedTextMessage as Record<string, unknown> | undefined
  if (options?.parserSemantics) {
    if (extText?.text && typeof extText.text === 'string') return extText.text
    const first = CAPTION_MEDIA_KEYS.map((k) => rawMsg[k] as Record<string, unknown> | undefined).find((m) => m != null)
    return first && typeof first.caption === 'string' ? first.caption : null
  }
  if (extText && typeof extText.text === 'string') return extText.text

  for (const key of CAPTION_MEDIA_KEYS) {
    const media = rawMsg[key] as Record<string, unknown> | undefined
    if (media && typeof media.caption === 'string') return media.caption
  }

  return null
}

/**
 * Text of an edit payload (`protocolMessage.editedMessage`): conversation, extended text, or an
 * image/video caption (documents and wrapped payloads are not consulted).
 * `skipEmpty` selects `||` (WAEventHandler) over `??` (ProtocolMessageProcessor) chaining.
 */
export function extractEditedText(
  edited: proto.IMessage | null | undefined,
  options?: { skipEmpty?: boolean }
): string | null {
  if (!edited) return null
  const candidates = [
    edited.conversation,
    edited.extendedTextMessage?.text,
    edited.imageMessage?.caption,
    edited.videoMessage?.caption
  ]
  if (options?.skipEmpty) return candidates.find((c) => !!c) || null
  return candidates.find((c) => c !== null && c !== undefined) ?? null
}

/** Classifies `protocolMessage.type` (numeric enum or its string name) as a revoke or an edit. */
export function classifyProtocolType(type: unknown): 'revoke' | 'edit' | null {
  if (type === PROTOCOL_TYPE_REVOKE || type === 'REVOKE') return 'revoke'
  if (type === PROTOCOL_TYPE_EDIT || type === 'MESSAGE_EDIT') return 'edit'
  return null
}

export const CIPHERTEXT_PLACEHOLDER_TEXT = 'Waiting for this message. This may take a while.'

export type StubClassification =
  | { kind: 'revoke' }
  | { kind: 'ciphertext'; messageType: 'ciphertext'; textContent: string }
  | { kind: 'system'; messageType: 'system'; content: { stubType: string; parameters: unknown[] } }

/**
 * Classifies a Baileys `messageStubType` (+ parameters). Returns null when there is no stub.
 * MessageParser uses all three kinds; the history-sync handler acts only on `revoke` and
 * `ciphertext` and keeps the content-derived type for other stubs (R-MSG-08 follow-up).
 */
export function classifyStub(stubType: unknown, parameters?: unknown): StubClassification | null {
  if (stubType === undefined || stubType === null) return null
  if (stubType === WAMessageStubType.REVOKE) return { kind: 'revoke' }
  if (stubType === WAMessageStubType.CIPHERTEXT) {
    return { kind: 'ciphertext', messageType: 'ciphertext', textContent: CIPHERTEXT_PLACEHOLDER_TEXT }
  }
  return {
    kind: 'system',
    messageType: 'system',
    content: {
      stubType: typeof stubType === 'number' ? WAMessageStubType[stubType] || 'UNKNOWN' : String(stubType),
      parameters: (parameters as unknown[] | null | undefined) || []
    }
  }
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
    const innerRec = unwrapped as Record<string, unknown>
    const innerCtx = innerRec.contextInfo || (innerRec.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo
    if (!innerCtx) {
      // Copy before patching so the caller's (possibly parsed-from-DB) object is never mutated.
      const unwrappedRec: Record<string, unknown> = { ...innerRec }
      if (unwrappedRec.extendedTextMessage && typeof unwrappedRec.extendedTextMessage === 'object') {
        unwrappedRec.extendedTextMessage = {
          ...(unwrappedRec.extendedTextMessage as Record<string, unknown>),
          contextInfo: outerContextInfo
        }
      } else {
        unwrappedRec.contextInfo = outerContextInfo
      }
      unwrapped = unwrappedRec as proto.IMessage
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
export function preserveContextInfo(
  existingJson: string | null | undefined,
  newContent: string | null | undefined,
  fallbackText?: string | null
): string {
  if (!newContent) return newContent ?? ''
  if (!existingJson) return newContent
  try {
    const existingParsed = JSON.parse(existingJson) as Record<string, unknown>
    const existingContextInfo = extractContextInfoFromContent(existingParsed)

    if (!existingContextInfo) return newContent

    const newParsed = JSON.parse(newContent || '{}') as Record<string, unknown>
    const newContextInfo = extractContextInfoFromContent(newParsed)

    if (!newContextInfo || (!newContextInfo.quotedMessage && existingContextInfo.quotedMessage)) {
      const mergedContextInfo = mergeContextInfo(existingContextInfo, newContextInfo)
      // An `editedMessage` echo wraps the real payload: work on the inner message.
      const wrapped = Boolean(newParsed.editedMessage)
      const result: Record<string, unknown> = {
        ...((wrapped ? unwrapMessage(newParsed as proto.IMessage) : newParsed) as Record<string, unknown>)
      }
      const ext = result.extendedTextMessage
      const mediaKey = EDITABLE_MEDIA_KEYS.find((k) => result[k] && typeof result[k] === 'object')
      if (mediaKey) {
        // Caption edit of a media message: keep it a media message, just restore the quote.
        result[mediaKey] = { ...(result[mediaKey] as Record<string, unknown>), contextInfo: mergedContextInfo }
      } else if (ext && typeof ext === 'object') {
        result.extendedTextMessage = { ...(ext as Record<string, unknown>), contextInfo: mergedContextInfo }
      } else {
        const text = (result.conversation as string) || fallbackText || ''
        result.extendedTextMessage = { text, contextInfo: mergedContextInfo }
        delete result.conversation
      }
      delete result.editedMessage
      if (wrapped) {
        const mci = newParsed.messageContextInfo ?? result.messageContextInfo ?? existingParsed.messageContextInfo
        if (mci) result.messageContextInfo = mci
      }
      return JSON.stringify(result)
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

/**
 * Message types whose `textContent` must NOT be pushed into the semantic-search
 * vector index. `ciphertext` carries only the "Waiting for this message"
 * placeholder, `system` carries stub metadata, and `reactionMessage` is not a
 * standalone searchable message. (P2-S2-01)
 */
const NON_INDEXABLE_MESSAGE_TYPES = new Set<string>([
  'ciphertext',
  'system',
  'reactionMessage',
  'protocolMessage',
  'senderKeyDistributionMessage',
  'unknown'
])

export function isIndexableMessageType(messageType: string | null | undefined): boolean {
  if (!messageType) return false
  return !NON_INDEXABLE_MESSAGE_TYPES.has(messageType)
}

type JsonRecord = Record<string, unknown>
export const EDITABLE_MEDIA_KEYS =['imageMessage', 'videoMessage', 'documentMessage'] as const

/**
 * Merges a stored contextInfo with the one carried by an edit. Incoming fields win.
 * Returns null when neither side has any context.
 */
export function mergeContextInfo(
  existing: JsonRecord | null | undefined,
  incoming: JsonRecord | null | undefined
): JsonRecord | null {
  if (!existing && !incoming) return null
  return { ...(existing ?? {}), ...(incoming ?? {}) }
}

export interface AppliedEdit {
  content: JsonRecord
  messageType: string
  textContent: string | null
}

/**
 * Pure: computes the stored content/type for an edit of a message.
 * Keeps the quote (contextInfo) and the E2EE `messageContextInfo` of the existing message.
 */
export function applyEdit(
  existingContent: JsonRecord | null | undefined,
  rawEditedContent: JsonRecord | null | undefined,
  editedText: string | null
): AppliedEdit {
  // The Baileys echo wraps the payload in `{editedMessage:{message:X}}`: work on X.
  const editedContent =
    rawEditedContent?.editedMessage ? (unwrapMessage(rawEditedContent as proto.IMessage) as JsonRecord) : rawEditedContent
  const existingMessageContextInfo = (existingContent?.messageContextInfo as JsonRecord | undefined) ?? null
  const mergedContextInfo = mergeContextInfo(
    extractContextInfoFromContent(existingContent),
    extractContextInfoFromContent(editedContent)
  )

  // Caption edit: patch the caption on the existing media message instead of rebuilding it as text.
  const mediaKey = EDITABLE_MEDIA_KEYS.find((k) => editedContent?.[k] && typeof editedContent[k] === 'object')
  if (mediaKey) {
    const editedMedia = editedContent?.[mediaKey] as JsonRecord
    const existingMedia = existingContent?.[mediaKey] as JsonRecord | undefined
    const caption = editedText ?? (editedMedia.caption as string | undefined) ?? (existingMedia?.caption as string | undefined) ?? null
    const media: JsonRecord = {
      ...(existingMedia ?? {}),
      ...editedMedia,
      ...(caption !== null ? { caption } : {}),
      ...(mergedContextInfo ? { contextInfo: mergedContextInfo } : {})
    }
    const content: JsonRecord = {
      ...(existingMedia ? existingContent : editedContent),
      [mediaKey]: media,
      ...(existingMessageContextInfo ? { messageContextInfo: existingMessageContextInfo } : {})
    }
    return { content, messageType: mediaKey, textContent: editedText ?? caption }
  }

  if (mergedContextInfo) {
    const extText = (editedContent?.extendedTextMessage as JsonRecord | undefined) ?? {}
    const content: JsonRecord = {
      ...(editedContent ?? {}),
      extendedTextMessage: {
        ...extText,
        text: editedText ?? (extText.text as string | undefined) ?? (editedContent?.conversation as string | undefined) ?? '',
        contextInfo: mergedContextInfo
      },
      ...(existingMessageContextInfo ? { messageContextInfo: existingMessageContextInfo } : {})
    }
    delete content.conversation
    delete content.editedMessage
    return { content, messageType: 'extendedTextMessage', textContent: editedText }
  }

  return {
    content: {
      ...(editedContent ?? {}),
      ...(existingMessageContextInfo ? { messageContextInfo: existingMessageContextInfo } : {})
    },
    messageType: editedContent?.extendedTextMessage ? 'extendedTextMessage' : 'conversation',
    textContent: editedText
  }
}

/**
 * Pure: folds rows that share an id into one row per id (original + edit + revoke).
 * The sync handler remaps edit/revoke rows onto the id of their target, so a batch can carry
 * several rows for the same id. Order in the batch does not matter: the original (a row that is
 * neither an edit nor a revoke) is the base, edits are applied on it with `applyEdit`, and a revoke
 * only sets `isDeleted`. Flags are monotonic (never true -> false). Output keeps first-seen order.
 */
export function foldSyncRows<
  T extends {
    id: string
    content: string
    messageType: string
    textContent?: string | null
    isEdited?: boolean
    isDeleted?: boolean
  }
>(rows: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const g = groups.get(r.id)
    if (g) g.push(r)
    else groups.set(r.id, [r])
  }
  const parse = (s: string): JsonRecord | null => {
    try {
      const v: unknown = JSON.parse(s)
      return v && typeof v === 'object' ? (v as JsonRecord) : null
    } catch {
      return null
    }
  }
  const out: T[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0])
      continue
    }
    const baseIdx = Math.max(0, group.findIndex((r) => !r.isEdited && !r.isDeleted))
    let acc: T = { ...group[baseIdx] }
    for (let i = 0; i < group.length; i++) {
      if (i === baseIdx) continue
      const r = group[i]
      if (r.isDeleted) acc.isDeleted = true
      if (r.isEdited) {
        const applied = applyEdit(parse(acc.content), parse(r.content), r.textContent ?? null)
        acc = {
          ...acc,
          content: JSON.stringify(applied.content),
          messageType: applied.messageType,
          textContent: applied.textContent,
          isEdited: true
        }
      }
    }
    out.push(acc)
  }
  return out
}
