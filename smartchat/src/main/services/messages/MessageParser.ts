import { WAMessageStubType, proto } from '@whiskeysockets/baileys'
import { mapBaileysStatus } from '../whatsapp/ReceiptService'
import { cleanJid, parseBaileysTimestamp, getMessageType, unwrapMessage } from '../../utils'
import { BaileysMessage } from '../../types'

/** Plain data object produced by parseMessageSync(). */
export interface ParsedMessage {
  id: string
  chatJid: string
  fromMe: boolean
  participantString: string | null
  timestamp: bigint
  messageType: string
  rawMessage: Record<string, unknown> | null
  textContent: string | null
  pushName: string | null
  status?: string
  isDeleted?: boolean
}

/**
 * MessageParser — Pure, stateless utility for parsing raw Baileys messages.
 *
 * Single Responsibility: transform Baileys `proto.IWebMessageInfo` objects into
 * strongly-typed `ParsedMessage` DTOs with zero database calls and zero side-effects.
 *
 * All methods are intentionally synchronous (or easily awaitable) to allow safe
 * use on large batches without blocking.
 */
export class MessageParser {
  /**
   * Returns `true` for message types that require special per-message handling:
   * - `protocolMessage`      (edit / revoke)
   * - `reactionMessage`      (emoji reaction)
   * - `secretEncryptedMessage` / `encReactionMessage` (e2e encrypted secret messages)
   *
   * These must NOT be bulk-persisted; the caller is responsible for routing them
   * to dedicated handlers.
   */
  isSpecialMessage(msg: BaileysMessage): boolean {
    const rawMessage = this._safeSerialize(msg.message)
    const unwrapped = rawMessage ? unwrapMessage(rawMessage) : null
    const messageType = unwrapped ? getMessageType(unwrapped) : 'unknown'
    return (
      messageType === 'protocolMessage' ||
      messageType === 'reactionMessage' ||
      messageType === 'secretEncryptedMessage' ||
      messageType === 'encReactionMessage'
    )
  }

  /**
   * Parses a raw Baileys message into a `ParsedMessage` DTO.
   *
   * Returns `null` for:
   * - Messages without a valid key ID.
   * - Messages classified as "special" (protocol / reaction / encrypted).
   */
  parseMessageSync(msg: BaileysMessage): ParsedMessage | null {
    const key = msg.key
    if (!key?.id) return null
    if (this.isSpecialMessage(msg)) return null

    const rawMessage = this._safeSerialize(msg.message)
    const remoteJid = cleanJid(key.remoteJid ?? '')
    const participantString = key.participant
      ? cleanJid(key.participant)
      : remoteJid.endsWith('@g.us')
      ? null
      : remoteJid

    const unwrapped = rawMessage ? unwrapMessage(rawMessage) : null
    const messageType = unwrapped ? getMessageType(unwrapped) : 'unknown'
    const textContent = this.extractTextContent(unwrapped)
    const timestamp = parseBaileysTimestamp(msg.messageTimestamp ?? 0)

    const isDeleted =
      msg.messageStubType === WAMessageStubType.REVOKE ||
      (msg.messageStubType === WAMessageStubType.CIPHERTEXT &&
        (msg.messageStubParameters?.includes('Message absent from node') ?? false))

    const status = mapBaileysStatus(msg.status)

    return {
      id: key.id,
      chatJid: remoteJid,
      fromMe: key.fromMe === true,
      participantString,
      timestamp,
      messageType,
      rawMessage,
      textContent,
      pushName: msg.pushName ?? null,
      status,
      isDeleted
    }
  }

  /**
   * Extracts human-readable text content from an unwrapped Baileys message object.
   * Handles plain conversations, extended text, and media captions.
   *
   * Returns `null` when no text is present (e.g. sticker, audio-only messages).
   */
  extractTextContent(unwrapped: proto.IMessage | Record<string, unknown> | null | undefined): string | null {
    if (!unwrapped) return null

    const rawMsg = unwrapped as Record<string, unknown>
    if (typeof rawMsg.conversation === 'string') {
      return rawMsg.conversation
    }

    const extMsg = rawMsg.extendedTextMessage as Record<string, unknown> | undefined
    if (extMsg?.text && typeof extMsg.text === 'string') {
      return extMsg.text
    }

    const mediaMsg =
      (rawMsg.imageMessage as Record<string, unknown> | undefined) ??
      (rawMsg.videoMessage as Record<string, unknown> | undefined) ??
      (rawMsg.documentMessage as Record<string, unknown> | undefined) ??
      (rawMsg.audioMessage as Record<string, unknown> | undefined) ??
      (rawMsg.ptvMessage as Record<string, unknown> | undefined)

    if (mediaMsg && typeof mediaMsg.caption === 'string') {
      return mediaMsg.caption
    }

    return null
  }

  /**
   * Safely serialize a `proto.IMessage` to a plain JSON object.
   * Handles circular references and protobuf-specific toJSON methods.
   */
  private _safeSerialize(
    message: BaileysMessage['message']
  ): Record<string, unknown> | null {
    if (!message) return null
    try {
      return JSON.parse(JSON.stringify(message)) as Record<string, unknown>
    } catch {
      // Fallback for proto objects with circular refs or toJSON methods
      const safeStringify = (obj: unknown): string =>
        JSON.stringify(obj, (_key, value: unknown) => {
          if (
            value &&
            typeof value === 'object' &&
            typeof (value as { toJSON?: unknown }).toJSON === 'function'
          ) {
            try {
              return (value as { toJSON: () => unknown }).toJSON()
            } catch {
              const copy: Record<string, unknown> = {}
              for (const k in value as object) {
                if (typeof (value as Record<string, unknown>)[k] !== 'function') {
                  copy[k] = (value as Record<string, unknown>)[k]
                }
              }
              return copy
            }
          }
          return value
        })
      try {
        return JSON.parse(safeStringify(message)) as Record<string, unknown>
      } catch {
        return null
      }
    }
  }
}
