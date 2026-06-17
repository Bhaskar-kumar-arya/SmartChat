import { PrismaClient, Message } from '@prisma/client'
import { WAMessageStubType, proto } from '@whiskeysockets/baileys'
import { ContactService } from '../contacts/ContactService'
import { MessageRepository, MessageUpsertData } from '../messages/MessageRepository'
import { mapBaileysStatus } from '../whatsapp/ReceiptService'
import { cleanJid, parseBaileysTimestamp, getMessageType, extractTextContent, unwrapMessage } from '../../utils'

export interface PendingReaction {
  targetId: string
  reactorId: number
  emoji: string
  timestamp: bigint
}

export interface SyncMessageRow extends MessageUpsertData {
  isEdited: boolean
}

/**
 * SyncMessagesHandler — Single Responsibility: **parse** history sync messages.
 *
 * This class handles only:
 *  1. Iterating the raw history payload in batches.
 *  2. Mapping each raw proto message to a typed `SyncMessageRow`.
 *  3. Collecting nested and inline reaction records.
 *  4. Delegating all DB writes to `MessageRepository`.
 *
 * It does NOT contain any Prisma calls of its own — those live in
 * `MessageRepository.bulkSyncMessages` and `MessageRepository.bulkSyncReactions`.
 */
export class SyncMessagesHandler {
  private readonly repository: MessageRepository

  constructor(
    private readonly prisma: PrismaClient,
    private readonly contactService: ContactService
  ) {
    this.repository = new MessageRepository(prisma)
  }

  /**
   * Process all messages from the sync payload in batches.
   *
   * @param messages        Raw message objects from the history sync payload.
   * @param processedChats  Set of JIDs for which a Chat row already exists.
   * @param meJid           The logged-in user's primary JID (for reaction resolution).
   * @param meIdentityId    The logged-in user's DB identity ID (for reaction attribution).
   */
  async processMessages(
    messages: Array<Record<string, unknown>>,
    processedChats: Set<string>,
    meJid: string | null,
    meIdentityId: number | null
  ): Promise<{ messageCount: number; importedMessages: Message[] }> {
    if (!messages || messages.length === 0) {
      return { messageCount: 0, importedMessages: [] }
    }

    // Build an in-memory JID -> identityId cache to avoid repeated DB round-trips
    const aliasRows = await this.prisma.identityAlias.findMany()
    const identityCache = new Map<string, number>()
    for (const row of aliasRows) {
      identityCache.set(row.jid, row.identityId)
    }

    const BATCH_SIZE = 200
    let messageCount = 0
    const importedMessages: Message[] = []

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE)
      const { messageRows, pendingReactions } = await this._parseBatch(
        batch,
        identityCache,
        processedChats,
        meJid
      )

      // Collect inline reactionMessage rows before splitting them out
      for (const msg of messageRows) {
        if (msg.messageType === 'reactionMessage') {
          this._extractInlineReaction(msg, meIdentityId, pendingReactions)
        }
      }

      const standardMessages = messageRows.filter(m => m.messageType !== 'reactionMessage')

      // Delegate all DB writes to the repository
      if (standardMessages.length > 0) {
        await this.repository.bulkSyncMessages(standardMessages)
        importedMessages.push(...(standardMessages as unknown as Message[]))
      }

      await this.repository.bulkSyncReactions(
        pendingReactions,
        new Set(messageRows.map(m => m.id))
      )

      messageCount += messageRows.length
      await new Promise(resolve => setImmediate(resolve))
    }

    return { messageCount, importedMessages }
  }

  // ─── Private parse helpers ───────────────────────────────────────────────────

  /**
   * Parse one batch of raw proto messages into typed rows + collect reactions.
   * Pure CPU work — no DB calls.
   */
  private async _parseBatch(
    batch: Array<Record<string, unknown>>,
    identityCache: Map<string, number>,
    processedChats: Set<string>,
    meJid: string | null
  ): Promise<{ messageRows: SyncMessageRow[]; pendingReactions: PendingReaction[] }> {
    const messageRows: SyncMessageRow[] = []
    const pendingReactions: PendingReaction[] = []

    for (const m of batch) {
      const mTyped = m as unknown as proto.IWebMessageInfo
      const key = mTyped.key
      if (!key?.id) continue

      const message = mTyped.message
      const timestamp = parseBaileysTimestamp(mTyped.messageTimestamp ?? 0)
      const remoteJid = cleanJid(String(key.remoteJid ?? ''))
      const unwrappedMessage = message
        ? (unwrapMessage(message) as Record<string, unknown>)
        : null

      let finalId = String(key.id)
      let finalMessageType = getMessageType(unwrappedMessage)
      let finalContent = JSON.stringify(message ?? {})
      let finalTextContent = extractTextContent(unwrappedMessage)
      let finalFromMe = key.fromMe === true
      let finalParticipantRaw = key.participant
        ? String(key.participant)
        : remoteJid.endsWith('@g.us')
        ? null
        : remoteJid
      let finalParticipant = finalParticipantRaw ? cleanJid(finalParticipantRaw) : null
      let isEdited = false

      const stubType = mTyped.messageStubType
      const stubParams = mTyped.messageStubParameters
      let isDeleted =
        stubType === WAMessageStubType.REVOKE ||
        (stubType === WAMessageStubType.CIPHERTEXT &&
          (stubParams?.includes('Message absent from node') ?? false))

      // Handle embedded protocol messages (edit / revoke)
      const protocolMessage = message?.protocolMessage
      if (protocolMessage?.key?.id) {
        const typeVal = protocolMessage.type as unknown
        const isEdit = typeVal === 14 || typeVal === 'MESSAGE_EDIT'
        const isRevoke = typeVal === 0 || typeVal === 'REVOKE'

        if (isEdit && protocolMessage.editedMessage) {
          const editedUnwrapped = unwrapMessage(protocolMessage.editedMessage) as Record<string, unknown>
          finalId = String(protocolMessage.key.id)
          finalMessageType = getMessageType(editedUnwrapped)
          finalContent = JSON.stringify(protocolMessage.editedMessage)
          finalTextContent = extractTextContent(editedUnwrapped)
          finalFromMe = protocolMessage.key.fromMe === true
          const targetJid = cleanJid(String(protocolMessage.key.remoteJid ?? remoteJid))
          const targetPRaw = protocolMessage.key.participant
            ? String(protocolMessage.key.participant)
            : targetJid.endsWith('@g.us') ? null : targetJid
          finalParticipant = targetPRaw ? cleanJid(targetPRaw) : null
          isEdited = true
        } else if (isRevoke) {
          finalId = String(protocolMessage.key.id)
          finalFromMe = protocolMessage.key.fromMe === true
          const targetJid = cleanJid(String(protocolMessage.key.remoteJid ?? remoteJid))
          const targetPRaw = protocolMessage.key.participant
            ? String(protocolMessage.key.participant)
            : targetJid.endsWith('@g.us') ? null : targetJid
          finalParticipant = targetPRaw ? cleanJid(targetPRaw) : null
          isDeleted = true
        }
      }

      // Resolve sender identity ID from in-memory cache first
      let senderId: number | null = null
      if (!finalFromMe && finalParticipant) {
        if (identityCache.has(finalParticipant)) {
          senderId = identityCache.get(finalParticipant) ?? null
        } else {
          await this.contactService
            .upsertContact({ id: finalParticipant })
            .catch((err: unknown) =>
              console.error('[SyncMessagesHandler] Failed to upsert participant contact:', err)
            )
          const newId = await this.contactService.getIdentityIdByJid(finalParticipant)
          if (newId) {
            senderId = newId
            identityCache.set(finalParticipant, newId)
          }
        }
      }

      // Collect nested reactions embedded on the message
      const reactions = mTyped.reactions
      if (reactions && reactions.length > 0) {
        await this._collectNestedReactions(reactions, finalId, meJid, identityCache, pendingReactions)
      }

      // Ensure Chat row exists for messages whose chat wasn't in the sync payload
      if (!processedChats.has(remoteJid)) {
        const chatType = remoteJid.endsWith('@g.us') ? 'GROUP' : 'DM'
        await this.prisma.chat
          .upsert({ where: { jid: remoteJid }, update: {}, create: { jid: remoteJid, type: chatType } })
          .catch((err: unknown) => console.error('[SyncMessagesHandler] chat upsert failed:', err))
        processedChats.add(remoteJid)
      }

      messageRows.push({
        id: finalId,
        chatJid: remoteJid,
        fromMe: finalFromMe,
        senderId,
        participant: finalParticipant,
        timestamp,
        messageType: finalMessageType,
        content: finalContent,
        textContent: finalTextContent,
        status: mapBaileysStatus(mTyped.status),
        isEdited,
        isDeleted
      })
    }

    return { messageRows, pendingReactions }
  }

  /**
   * Extract an inline `reactionMessage` row into a pending reaction entry.
   */
  private _extractInlineReaction(
    msg: SyncMessageRow,
    meIdentityId: number | null,
    pendingReactions: PendingReaction[]
  ): void {
    try {
      const rawMsg = JSON.parse(msg.content) as Record<string, unknown>
      const reaction = rawMsg.reactionMessage as Record<string, unknown> | undefined
      const key = reaction?.key as Record<string, unknown> | undefined
      if (key?.id && reaction?.text) {
        const targetId = String(key.id)
        const emoji = String(reaction.text)
        let reactorId = msg.senderId
        if (msg.fromMe && meIdentityId) reactorId = meIdentityId
        if (emoji && reactorId) {
          pendingReactions.push({ targetId, reactorId, emoji, timestamp: msg.timestamp })
        }
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.error('[SyncMessagesHandler] Failed to parse reaction message JSON:', errMsg)
    }
  }

  /**
   * Collect reactions that are nested on a message in the history payload.
   */
  private async _collectNestedReactions(
    reactions: proto.IReaction[],
    targetId: string,
    meJid: string | null,
    identityCache: Map<string, number>,
    pendingReactions: PendingReaction[]
  ): Promise<void> {
    for (const r of reactions) {
      const reactionKey = r.key
      const emoji = r.text
      const ts = r.senderTimestampMs
      if (!emoji || !reactionKey) continue

      let reactorJidRaw: string | null | undefined =
        reactionKey.participant ??
        (reactionKey.remoteJid?.endsWith('@g.us') ? null : reactionKey.remoteJid)
      if (reactionKey.fromMe && meJid) reactorJidRaw = meJid

      const reactorJid = reactorJidRaw ? cleanJid(reactorJidRaw) : null
      let reactorId: number | null = null

      if (reactorJid) {
        if (identityCache.has(reactorJid)) {
          reactorId = identityCache.get(reactorJid) ?? null
        } else {
          await this.contactService
            .upsertContact({ id: reactorJid })
            .catch((err: unknown) =>
              console.error('[SyncMessagesHandler] Failed to upsert reactor contact:', err)
            )
          const newId = await this.contactService.getIdentityIdByJid(reactorJid)
          if (newId) {
            reactorId = newId
            identityCache.set(reactorJid, newId)
          }
        }
      }

      if (reactorId) {
        let reactionTs = parseBaileysTimestamp(
          typeof ts === 'object' && ts !== null && 'low' in (ts as unknown as Record<string, unknown>)
            ? ts
            : ts ?? Math.floor(Date.now() / 1000)
        )
        if (reactionTs > 9999999999n) reactionTs = reactionTs / 1000n
        pendingReactions.push({ targetId, reactorId, emoji, timestamp: reactionTs })
      }
    }
  }
}
