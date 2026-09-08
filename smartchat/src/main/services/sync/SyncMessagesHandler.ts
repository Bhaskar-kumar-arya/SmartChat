import { WAMessageStubType } from '@whiskeysockets/baileys'
import { SyncStickerCandidate } from '../messages/IMediaService'
import { IContactMutationService, IContactQueryService } from '../contacts/IContactService'
import { IMessageRepository, MessageUpsertData } from '../messages/IMessageRepository'
import { IReactionRepository } from '../messages/IReactionRepository'
import { IAliasRepository } from '../contacts/IAliasRepository'
import { IChatRepository } from '../chats/IChatRepository'
import { mapBaileysStatus } from '../whatsapp/ReceiptService'
import { cleanJid } from '../../utils/jidUtils'
import { parseBaileysTimestamp, getMessageType, extractTextContent, unwrapMessage } from '../../utils/messageUtils'
import { BaileysWebMessageInfo, BaileysReaction } from '../whatsapp/types'

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
  constructor(
    private readonly repository: IMessageRepository,
    private readonly reactionRepository: IReactionRepository,
    private readonly aliasRepository: IAliasRepository,
    private readonly chatRepository: IChatRepository,
    private readonly contactService: IContactMutationService & IContactQueryService
  ) {}

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
  ): Promise<{ messageCount: number; importedMessages: SyncStickerCandidate[] }> {
    if (!messages || messages.length === 0) {
      return { messageCount: 0, importedMessages: [] }
    }

    // Ensure the logged-in user has a resolvable identity id before parsing.
    // `_extractInlineReaction` attributes `fromMe` history-synced reactions to
    // `meIdentityId`; if it is still null (very early sync, self-contact not yet
    // created) those reactions would be silently dropped. (P2-S4-05)
    let resolvedMeIdentityId = meIdentityId
    if (resolvedMeIdentityId === null && meJid) {
      await this.contactService
        .upsertContact({ id: meJid })
        .catch((err: unknown) =>
          console.error('[SyncMessagesHandler] Failed to upsert self contact:', err)
        )
      resolvedMeIdentityId = await this.contactService.getIdentityIdByJid(meJid)
    }

    // Build an in-memory JID -> identityId cache to avoid repeated DB round-trips
    const aliasRows = await this.aliasRepository.findAllAliases()
    const identityCache = new Map<string, number>()
    for (const row of aliasRows) {
      identityCache.set(row.jid, row.identityId)
    }

    const BATCH_SIZE = 200
    let messageCount = 0
    const importedMessages: SyncStickerCandidate[] = []

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
          this._extractInlineReaction(msg, resolvedMeIdentityId, pendingReactions)
        }
      }

      const standardMessages = messageRows.filter(m => m.messageType !== 'reactionMessage')

      // Delegate all DB writes to the repository. Only the rows that were
      // genuinely inserted are surfaced to the caller — re-syncing an overlapping
      // history chunk must not re-queue favorite-sticker downloads for messages
      // already in the DB. (P2-S4-06)
      if (standardMessages.length > 0) {
        const inserted = await this.repository.bulkSyncMessages(standardMessages)
        for (const row of inserted) {
          importedMessages.push({ id: row.id, content: row.content, messageType: row.messageType })
        }
      }

      await this.reactionRepository.bulkSyncReactions(pendingReactions)

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
  private _parseMessageProperties(
    mTyped: BaileysWebMessageInfo,
    remoteJid: string
  ): {
    id: string
    messageType: string
    content: string
    textContent: string | null
    fromMe: boolean
    participant: string | null
    isEdited: boolean
    isDeleted: boolean
  } | null {
    const key = mTyped.key
    if (!key?.id) return null

    const message = mTyped.message
    const unwrappedMessage = message ? (unwrapMessage(message) as Record<string, unknown>) : null

    let finalId = String(key.id)
    let finalMessageType = getMessageType(unwrappedMessage)
    if (finalMessageType === 'senderKeyDistributionMessage') return null

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
    let isDeleted = false

    const stubType = mTyped.messageStubType
    if (stubType === WAMessageStubType.REVOKE && !message?.protocolMessage) {
      const targetId = Array.isArray(mTyped.messageStubParameters)
        ? (mTyped.messageStubParameters[0] as string | undefined)
        : undefined
      if (targetId) {
        finalId = targetId
        finalMessageType = 'unknown'
        finalContent = '{}'
        finalTextContent = null
        isDeleted = true
      } else {
        return null
      }
    }

    if (stubType === WAMessageStubType.CIPHERTEXT) {
      finalMessageType = 'ciphertext'
      finalTextContent = 'Waiting for this message. This may take a while.'
    }

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

    return {
      id: finalId,
      messageType: finalMessageType,
      content: finalContent,
      textContent: finalTextContent,
      fromMe: finalFromMe,
      participant: finalParticipant,
      isEdited,
      isDeleted
    }
  }

  private async _resolveSenderId(
    participant: string | null,
    fromMe: boolean,
    identityCache: Map<string, number>
  ): Promise<number | null> {
    if (fromMe || !participant) return null
    if (identityCache.has(participant)) {
      return identityCache.get(participant) ?? null
    }

    await this.contactService
      .upsertContact({ id: participant })
      .catch((err: unknown) =>
        console.error('[SyncMessagesHandler] Failed to upsert participant contact:', err)
      )

    const newId = await this.contactService.getIdentityIdByJid(participant)
    if (newId) {
      identityCache.set(participant, newId)
      return newId
    }
    return null
  }

  /**
   * Resolve a whole batch's worth of sender/reactor JIDs into `identityCache` up
   * front, replacing thousands of strictly-sequential per-message round-trips
   * (upsertContact → getIdentityIdByJid) with two batched queries + one parallel
   * create pass for genuinely-new participants.
   */
  private async _prefetchIdentityIds(
    jids: string[],
    identityCache: Map<string, number>
  ): Promise<void> {
    if (jids.length === 0) return

    // 1. One batched read for identities that already exist.
    const known = await this.contactService.batchGetIdentityIds(jids)
    for (const [jid, id] of known) identityCache.set(jid, id)

    // 2. Create the genuinely-new participants (in parallel), then one more
    //    batched read to pick up their new ids.
    const missing = jids.filter(j => !identityCache.has(j))
    if (missing.length === 0) return

    await Promise.all(
      missing.map(j =>
        this.contactService
          .upsertContact({ id: j })
          .catch((err: unknown) =>
            console.error('[SyncMessagesHandler] Failed to upsert participant contact:', err)
          )
      )
    )

    const resolved = await this.contactService.batchGetIdentityIds(missing)
    for (const [jid, id] of resolved) identityCache.set(jid, id)
  }

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

    // ── Pass 1: pure-CPU parse + collect every sender/reactor JID in the batch ──
    const parsedList: Array<{
      mTyped: BaileysWebMessageInfo
      remoteJid: string
      parsed: NonNullable<ReturnType<SyncMessagesHandler['_parseMessageProperties']>>
    }> = []
    const jidsToResolve = new Set<string>()

    for (const m of batch) {
      const mTyped = m as unknown as BaileysWebMessageInfo
      const remoteJid = cleanJid(String(mTyped.key?.remoteJid ?? ''))
      if (!remoteJid) continue

      const parsed = this._parseMessageProperties(mTyped, remoteJid)
      if (!parsed) continue

      parsedList.push({ mTyped, remoteJid, parsed })

      if (!parsed.fromMe && parsed.participant && !identityCache.has(parsed.participant)) {
        jidsToResolve.add(parsed.participant)
      }

      const reactions = mTyped.reactions
      if (reactions && reactions.length > 0) {
        for (const r of reactions) {
          if (!r.text || !r.key) continue
          let raw: string | null | undefined =
            r.key.participant ?? (r.key.remoteJid?.endsWith('@g.us') ? null : r.key.remoteJid)
          if (r.key.fromMe && meJid) raw = meJid
          const rj = raw ? cleanJid(raw) : null
          if (rj && !identityCache.has(rj)) jidsToResolve.add(rj)
        }
      }
    }

    // Bulk-resolve everything the batch needs in a couple of queries.
    await this._prefetchIdentityIds(Array.from(jidsToResolve), identityCache)

    // ── Pass 2: build rows (sender lookups now hit the warmed cache) ──
    // Chats that appear only in `messages[]` (not `chats[]`) need a Chat row. Seed
    // it with the newest message timestamp seen for that chat in this batch so it
    // doesn't sort to the very bottom of the list with `timestamp = 0n` until a
    // live message arrives. (P2-S4-04)
    const newChatMaxTs = new Map<string, bigint>()

    for (const { mTyped, remoteJid, parsed } of parsedList) {
      const senderId = await this._resolveSenderId(parsed.participant, parsed.fromMe, identityCache)

      // Collect nested reactions embedded on the message
      const reactions = mTyped.reactions
      if (reactions && reactions.length > 0) {
        await this._collectNestedReactions(reactions, parsed.id, meJid, identityCache, pendingReactions)
      }

      const msgTs = parseBaileysTimestamp(mTyped.messageTimestamp ?? 0)

      if (!processedChats.has(remoteJid)) {
        const prev = newChatMaxTs.get(remoteJid) ?? 0n
        if (msgTs > prev) newChatMaxTs.set(remoteJid, msgTs)
      }

      messageRows.push({
        id: parsed.id,
        chatJid: remoteJid,
        fromMe: parsed.fromMe,
        senderId,
        participant: parsed.participant,
        timestamp: msgTs,
        messageType: parsed.messageType,
        content: parsed.content,
        textContent: parsed.textContent,
        status: mapBaileysStatus(mTyped.status),
        isEdited: parsed.isEdited,
        isDeleted: parsed.isDeleted
      })
    }

    // Create any missing Chat rows before the caller persists the messages that
    // reference them.
    for (const [remoteJid, maxTs] of newChatMaxTs) {
      await this.chatRepository
        .upsertChat(remoteJid, maxTs > 0n ? { timestamp: maxTs } : {})
        .catch((err: unknown) => console.error('[SyncMessagesHandler] chat upsert failed:', err))
      processedChats.add(remoteJid)
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
    reactions: BaileysReaction[],
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
      const reactorId = await this._resolveSenderId(reactorJid, false, identityCache)

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
