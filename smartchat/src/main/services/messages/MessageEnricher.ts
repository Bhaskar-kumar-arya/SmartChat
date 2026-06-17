import { ContactService } from '../contacts/ContactService'
import { cleanJid, unwrapMessage } from '../../utils'
import { WASocket, DBMessageWithSender, EnrichedMessage, EnrichedReaction } from '../../types'

/**
 * MessageEnricher — Single Responsibility: transform raw database message rows
 * into UI-ready `EnrichedMessage` objects with resolved display names,
 * context-info participant names, and mention maps.
 *
 * This class must NEVER perform database writes or contain business logic.
 * It is a pure read + transform layer for the presentation/IPC boundary.
 */
export class MessageEnricher {
  constructor(private readonly contactService: ContactService) {}

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
    sock: WASocket | null,
    nameMap: Map<string, string>
  ): Promise<EnrichedMessage> {
    const participantName = this._resolveParticipantName(msg, nameMap)

    let finalContent: Record<string, unknown> = {}
    try {
      finalContent = JSON.parse(msg.content) as Record<string, unknown>
    } catch {
      // Non-fatal: keep empty object
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
    if (msg.sender) return ContactService.getDisplayName(msg.sender, 'Unknown')
    if (msg.participant) {
      return nameMap.get(msg.participant) ?? msg.participant.replace(/@.*$/, '')
    }
    return 'Unknown'
  }

  /**
   * Extract contextInfo from any message type that carries it.
   */
  private _extractContextInfo(
    unwrapped: Record<string, unknown> | null | undefined
  ): Record<string, unknown> | null {
    if (!unwrapped) return null
    return (
      (unwrapped.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (unwrapped.imageMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (unwrapped.videoMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (unwrapped.documentMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (unwrapped.audioMessage as Record<string, unknown> | undefined)?.contextInfo as Record<string, unknown> |
        undefined ??
      (unwrapped.contextInfo as Record<string, unknown> | undefined) ??
      null
    )
  }

  /**
   * Mutate the context object in place to attach resolved names for participants
   * and mentions (both in the message and in nested quoted messages).
   */
  private async _enrichContextInfo(
    ctx: Record<string, unknown>,
    sock: WASocket | null,
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
      const q = unwrapMessage(ctx.quotedMessage as Record<string, unknown>)
      const qCtx =
        (q?.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo as
          | Record<string, unknown>
          | undefined ??
        (q?.imageMessage as Record<string, unknown> | undefined)?.contextInfo as
          | Record<string, unknown>
          | undefined ??
        (q?.contextInfo as Record<string, unknown> | undefined)

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
