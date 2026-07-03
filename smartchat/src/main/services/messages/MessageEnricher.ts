import { ContactNameResolver } from '../contacts/ContactNameResolver'
import { IContactQueryService, ISocketUserContext } from '../contacts/IContactService'
import { cleanJid } from '../../utils/jidUtils'
import { unwrapMessage } from '../../utils/messageUtils'
import { WAMessageContent } from '../whatsapp/types'
import { DBMessageWithSender } from '../../domain/db.types'
import { EnrichedMessage } from '../../ipc/message.types'
import { EnrichedReaction } from '../../ipc/reaction.types'
import { IMessageEnricher } from './IMessageEnricher'

/**
 * MessageEnricher — Single Responsibility: transform raw database message rows
 * into UI-ready `EnrichedMessage` objects with resolved display names,
 * context-info participant names, and mention maps.
 *
 * This class must NEVER perform database writes or contain business logic.
 * It is a pure read + transform layer for the presentation/IPC boundary.
 */
export class MessageEnricher implements IMessageEnricher {
  constructor(private readonly contactService: IContactQueryService) {}

  /**
   * Enrich a single database message with contact display names and
   * resolved context information (quotes, mentions, participant names).
   *
   * @param msg     The raw DB message row (with optional `sender` relation).
   * @param sock    The active WhatsApp socket (used for resolving "me" JIDs).
   * @param nameMap Pre-resolved name map for JIDs that appear in the message.
   */
  async enrichMessage(
    msg: DBMessageWithSender,
    sock: ISocketUserContext | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage> {
    const participantName = this._resolveParticipantName(msg, nameMap)

    let finalContent: Record<string, unknown> = {}
    try {
      finalContent = JSON.parse(msg.content) as Record<string, unknown>
    } catch (err: unknown) {
      console.warn(`[MessageEnricher] Failed to parse message content for ${msg.id}:`, err)
    }

    if (msg.messageType === 'system') {
      const stubType = finalContent.stubType
      const params = finalContent.parameters

      const isJid = (val: unknown): boolean =>
        typeof val === 'string' &&
        (val.includes('@s.whatsapp.net') || val.includes('@lid') || val.includes('@g.us'))

      /**
       * Produce a display-safe name from an arbitrary stub parameter string.
       *
       * Baileys encodes LID participants as JSON-stringified objects like:
       *   '{"id":"<lid>@lid","phoneNumber":"<pn>@s.whatsapp.net","admin":null}'
       *
       * Resolution priority:
       *   1. Proper JID string  → look up in nameMap, fallback to local part before '@'.
       *   2. Bare number string → use as display name (no @-domain present).
       *   3. JSON blob          → extract phoneNumber (preferred) or id JID, resolve from nameMap.
       *   4. Plain string       → render as-is (e.g. a group subject change value).
       */
      const resolveContact = (raw: string): { jid: string; name: string } | string => {
        // Baileys LID/PN JSON blob: {id, phoneNumber, admin, ...}
        if (raw.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>
            const pnJid = typeof parsed.phoneNumber === 'string' && isJid(parsed.phoneNumber)
              ? parsed.phoneNumber : null
            const lidJid = typeof parsed.id === 'string' && isJid(parsed.id)
              ? parsed.id : null

            // Prioritize LID JID for opening/selecting chat in the UI.
            const clickJid = lidJid ?? pnJid ?? ''

            const pnName = pnJid ? nameMap.get(pnJid) : null
            const lidName = lidJid ? nameMap.get(lidJid) : null

            // A name is a fallback if it is missing or consists solely of digits (indicating raw ID / number)
            const isFallback = (n: string | null | undefined) => !n || /^\d+$/.test(n.trim())

            let resolvedName = ''
            if (pnName && !isFallback(pnName)) {
              resolvedName = pnName
            } else if (lidName && !isFallback(lidName)) {
              resolvedName = lidName
            } else {
              // Fallback to nameMap values (even if numeric/fallback) or split JID prefix.
              resolvedName = pnName || lidName || (pnJid ? pnJid.split('@')[0] : '') || (lidJid ? lidJid.split('@')[0] : 'Unknown')
            }

            return { jid: clickJid, name: resolvedName }
          } catch (err: unknown) {
            console.warn('[MessageEnricher] Failed to parse stub parameter as JSON:', err)
          }
        }

        if (isJid(raw)) {
          const name = nameMap.get(raw) || raw.split('@')[0]
          return { jid: raw, name }
        }
        // Bare numeric phone number (no domain).
        if (/^\d+$/.test(raw.trim())) {
          return { jid: '', name: raw.trim() }
        }
        // Plain non-JID, non-numeric string — render as-is (e.g. group subject).
        return raw
      }

      const enrichedParams = Array.isArray(params)
        ? params.map((p) => resolveContact(String(p)))
        : []

      finalContent = {
        stubType: typeof stubType === 'string' ? stubType : 'UNKNOWN',
        parameters: enrichedParams
      }

      return {
        ...msg,
        participantName,
        timestamp: msg.timestamp.toString(),
        content: JSON.stringify(finalContent)
      }
    }

    const unwrapped = unwrapMessage(finalContent)
    const ctx = this._extractContextInfo(unwrapped)

    if (ctx) {
      await this._enrichContextInfo(ctx, sock, nameMap)
    }

    return {
      ...msg,
      participantName,
      timestamp: msg.timestamp.toString(),
      content: JSON.stringify(finalContent)
    }
  }

  /**
   * Map raw DB reaction rows into `EnrichedReaction` objects for the frontend.
   */
  enrichReactions(
    reactions: Array<{
      messageId: string
      text: string
      timestamp: bigint
      senderId: number
      sender: {
        displayName?: string | null
        pushName?: string | null
        phoneNumber?: string | null
      }
    }>
  ): EnrichedReaction[] {
    return reactions.map(r => ({
      text: r.text,
      senderId: r.sender.phoneNumber ?? '',
      senderName:
        r.sender.displayName ??
        r.sender.pushName ??
        r.sender.phoneNumber?.split('@')[0] ??
        'Unknown',
      timestamp: r.timestamp.toString()
    }))
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _resolveParticipantName(
    msg: DBMessageWithSender,
    nameMap: Map<string, string>
  ): string {
    if (msg.fromMe) return 'Me'
    if (msg.sender) return ContactNameResolver.getDisplayName(msg.sender, 'Unknown')
    if (msg.participant) {
      const fromMap = nameMap.get(msg.participant)
      if (fromMap) return fromMap
      // Guard against malformed JSON-like participant strings (e.g. Baileys LID blobs).
      const stripped = msg.participant.replace(/@.*$/, '')
      if (/^[{[]/.test(stripped)) {
        // Looks like a JSON fragment — try to extract a numeric id.
        try {
          const parsed = JSON.parse(msg.participant) as Record<string, unknown>
          const id = String(parsed.id ?? parsed.jid ?? '')
          if (id && /^\d+$/.test(id)) return id
        } catch (err: unknown) {
          console.warn('[MessageEnricher] Failed to parse participant as JSON:', err)
        }
        return 'Unknown'
      }
      return stripped
    }
    return 'Unknown'
  }

  private _extractContextInfo(
    unwrapped: WAMessageContent | Record<string, unknown> | null | undefined
  ): Record<string, unknown> | null {
    if (!unwrapped) return null
    const rawMsg = unwrapped as Record<string, unknown>
    return (
      (rawMsg.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (rawMsg.imageMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (rawMsg.videoMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (rawMsg.documentMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (rawMsg.audioMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (rawMsg.contextInfo as Record<string, unknown> | undefined) ??
      null
    )
  }

  /**
   * Mutate the context object in place to attach resolved names for participants
   * and mentions (both in the message and in nested quoted messages).
   */
  private async _enrichContextInfo(
    ctx: Record<string, unknown>,
    sock: ISocketUserContext | null,
    nameMap: Map<string, string>
  ): Promise<void> {
    if (ctx.participant && typeof ctx.participant === 'string') {
      const meJids = await this.contactService.getMeJids(sock)
      const cleanParticipant = cleanJid(ctx.participant)
      ctx.participantName = meJids.includes(cleanParticipant)
        ? 'You'
        : nameMap.get(ctx.participant) ?? ctx.participant.replace(/@.*$/, '')
    }

    if (ctx.mentionedJid && Array.isArray(ctx.mentionedJid)) {
      ctx.mentions = Object.fromEntries(
        (ctx.mentionedJid as string[]).map(jid => [
          jid,
          nameMap.get(jid) ?? jid.replace(/@.*$/, '')
        ])
      )
    }

    if (ctx.quotedMessage && typeof ctx.quotedMessage === 'object') {
      const q = unwrapMessage(ctx.quotedMessage as WAMessageContent)
      const qRaw = q as Record<string, unknown>
      const qCtx =
        (qRaw?.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo as
          | Record<string, unknown>
          | undefined ??
        (qRaw?.imageMessage as Record<string, unknown> | undefined)?.contextInfo as
          | Record<string, unknown>
          | undefined ??
        (qRaw?.contextInfo as Record<string, unknown> | undefined)

      if (qCtx?.mentionedJid && Array.isArray(qCtx.mentionedJid)) {
        qCtx.mentions = Object.fromEntries(
          (qCtx.mentionedJid as string[]).map(jid => [
            jid,
            nameMap.get(jid) ?? jid.replace(/@.*$/, '')
          ])
        )
      }
    }
  }
}
