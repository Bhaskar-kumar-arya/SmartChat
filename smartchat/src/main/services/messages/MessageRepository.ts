import { PrismaClient, Message } from '@prisma/client'
import { unwrapMessage } from '../../utils'
import { MediaMessageWithLocalUri } from '../../types'

export interface MessageUpsertData {
  id: string
  chatJid: string
  fromMe: boolean
  senderId: number | null
  participant: string | null
  timestamp: bigint
  messageType: string
  content: string
  textContent: string | null
  status: string | null
  isDeleted: boolean
  isEdited?: boolean
}

/**
 * MessageRepository — Single Responsibility: all Prisma/database operations
 * related to the `Message` and `Reaction` tables.
 *
 * This class must NEVER contain business logic, parsing, or UI enrichment.
 * It is a pure data-access layer: reads and writes only.
 */
export class MessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert a single message into the database.
   * Preserves any `localURI` that was previously saved on media message content,
   * so that re-sync events do not wipe cached file paths.
   */
  async upsertMessage(data: MessageUpsertData): Promise<void> {
    let contentToStore = data.content

    // Preserve existing localURI on media messages
    const existing = await this.prisma.message.findUnique({
      where: { id: data.id },
      select: { content: true }
    })
    if (existing?.content && data.content) {
      try {
        const existingContent = JSON.parse(existing.content)
        const existingUnwrapped = unwrapMessage(existingContent)
        const existingMediaMsg = (
          existingUnwrapped?.imageMessage ??
          existingUnwrapped?.stickerMessage ??
          existingUnwrapped?.videoMessage ??
          existingUnwrapped?.documentMessage ??
          existingUnwrapped?.audioMessage
        ) as MediaMessageWithLocalUri | undefined

        if (existingMediaMsg && existingMediaMsg.localURI) {
          const currentParsed = JSON.parse(data.content)
          const currentUnwrapped = unwrapMessage(currentParsed)
          const currentMediaMsg = (
            currentUnwrapped?.imageMessage ??
            currentUnwrapped?.stickerMessage ??
            currentUnwrapped?.videoMessage ??
            currentUnwrapped?.documentMessage ??
            currentUnwrapped?.audioMessage
          ) as MediaMessageWithLocalUri | undefined
          if (currentMediaMsg) {
            currentMediaMsg.localURI = existingMediaMsg.localURI
            contentToStore = JSON.stringify(currentParsed)
          }
        }
      } catch (e: unknown) {
        console.error('[MessageRepository] Failed to preserve localURI on upsert:', e)
      }
    }

    const { id, ...rest } = data
    await this.prisma.message
      .upsert({
        where: { id },
        update: {
          textContent: rest.textContent,
          messageType: rest.messageType,
          content: contentToStore,
          timestamp: rest.timestamp,
          senderId: rest.senderId,
          participant: rest.participant,
          status: rest.status,
          ...(rest.isDeleted ? { isDeleted: true } : {}),
          ...(rest.isEdited !== undefined ? { isEdited: rest.isEdited } : {})
        },
        create: { id, ...rest, content: contentToStore }
      })
      .catch((err: unknown) => {
        console.error(`[MessageRepository] Failed to upsert message ${id}:`, err)
      })
  }

  /**
   * Bulk-persist a set of new message rows using `createMany`.
   * Skips rows whose IDs already exist in the database.
   *
   * @param rows  Fully prepared DB rows (pre-fetched existence check recommended).
   */
  async bulkCreateMessages(rows: MessageUpsertData[]): Promise<void> {
    if (rows.length === 0) return
    await this.prisma.message.createMany({ data: rows }).catch(async () => {
      // Fallback: individual upserts in a single transaction
      const ops = rows.map(r =>
        this.prisma.message.upsert({ where: { id: r.id }, update: r, create: r })
      )
      await this.prisma.$transaction(ops).catch((err: unknown) => {
        console.error('[MessageRepository] bulkCreateMessages fallback transaction failed:', err)
      })
    })
  }

  /**
   * Marks a message as deleted (`isDeleted = true`).
   */
  async revokeMessage(messageId: string): Promise<void> {
    await this.prisma.message
      .updateMany({ where: { id: messageId }, data: { isDeleted: true } })
      .catch((err: unknown) => {
        console.warn(`[MessageRepository] Failed to mark message ${messageId} as deleted:`, err)
      })
  }

  /**
   * Updates a message's content and marks it as edited.
   *
   * Preserves the original `messageContextInfo` (which contains the message secret)
   * so that subsequent edits or encrypted actions can still be decrypted.
   */
  async editMessage(
    messageId: string,
    textContent: string | null,
    editedContent: Record<string, unknown> | null
  ): Promise<void> {
    let originalContextInfo: Record<string, unknown> | null = null
    try {
      const existing = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { content: true }
      })
      if (existing?.content) {
        const parsed = JSON.parse(existing.content) as Record<string, unknown>
        originalContextInfo = (parsed.messageContextInfo as Record<string, unknown>) ?? null
      }
    } catch {
      // Non-fatal — proceed without preserving the secret
    }

    const contentToStore = {
      ...(editedContent ?? {}),
      ...(originalContextInfo ? { messageContextInfo: originalContextInfo } : {})
    }

    // Derive messageType from the edited content so the DB column stays in sync
    const newMessageType =
      editedContent?.extendedTextMessage ? 'extendedTextMessage' : 'conversation'

    await this.prisma.message
      .updateMany({
        where: { id: messageId },
        data: {
          content: JSON.stringify(contentToStore),
          textContent,
          messageType: newMessageType,
          isEdited: true
        }
      })
      .catch((err: unknown) => {
        console.warn(`[MessageRepository] Failed to update edited message ${messageId}:`, err)
      })
  }

  /**
   * Upsert a reaction record.
   * If `emoji` is empty/null, the reaction is deleted instead.
   */
  async upsertReaction(
    messageId: string,
    reactorId: number,
    emoji: string | null,
    timestamp: bigint
  ): Promise<void> {
    if (!emoji) {
      await this.prisma.reaction
        .deleteMany({ where: { messageId, senderId: reactorId } })
        .catch((err: unknown) => {
          console.error('[MessageRepository] Failed to delete reaction:', err)
        })
      return
    }

    await this.prisma.reaction
      .upsert({
        where: { messageId_senderId: { messageId, senderId: reactorId } },
        update: { text: emoji, timestamp },
        create: { messageId, senderId: reactorId, text: emoji, timestamp }
      })
      .catch((err: unknown) => {
        console.error('[MessageRepository] Failed to upsert reaction:', err)
      })
  }

  /**
   * Fetch existing message IDs from a list for pre-existence checks.
   */
  async findExistingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const rows = await this.prisma.message.findMany({
      where: { id: { in: ids } },
      select: { id: true }
    })
    return new Set(rows.map(r => r.id))
  }

  /**
   * Update an arbitrary set of fields on a message by ID.
   * Used for post-send localURI injection after media upload.
   */
  async updateMessageContent(messageId: string, content: string): Promise<void> {
    await this.prisma.message
      .update({ where: { id: messageId }, data: { content } })
      .catch((err: unknown) => {
        console.error(`[MessageRepository] Failed to update content for message ${messageId}:`, err)
      })
  }

  /**
   * Bulk-persist a batch of sync message rows:
   *  - `createMany` for rows that don't yet exist.
   *  - Individual `update` for existing rows, preserving any cached `localURI`.
   *
   * Used exclusively by SyncMessagesHandler during history sync.
   */
  async bulkSyncMessages(rows: MessageUpsertData[]): Promise<void> {
    if (rows.length === 0) return

    const batchIds = rows.map(m => m.id)
    const existingMsgs = await this.prisma.message.findMany({
      where: { id: { in: batchIds } },
      select: { id: true }
    })
    const existingIds = new Set(existingMsgs.map(m => m.id))

    const newMessages = rows.filter(m => !existingIds.has(m.id))
    const existingMessages = rows.filter(m => existingIds.has(m.id))

    // Insert brand-new messages
    if (newMessages.length > 0) {
      await this.prisma.message.createMany({ data: newMessages }).catch(async () => {
        const fallbackOps = newMessages.map(m =>
          this.prisma.message.upsert({ where: { id: m.id }, update: m, create: m })
        )
        await this.prisma
          .$transaction(fallbackOps)
          .catch((err: unknown) =>
            console.error('[MessageRepository] bulkSyncMessages createMany fallback failed:', err)
          )
      })
    }

    // Update existing messages, preserving localURI on media content
    if (existingMessages.length > 0) {
      const dbExisting = await this.prisma.message.findMany({
        where: { id: { in: existingMessages.map(m => m.id) } },
        select: { id: true, content: true }
      })
      const existingContentMap = new Map<string, string>()
      for (const row of dbExisting) {
        if (row.content) existingContentMap.set(row.id, row.content)
      }

      const updateOps = existingMessages.map(msg => {
        const update: Record<string, unknown> = {}
        if (msg.chatJid) update.chatJid = msg.chatJid
        if (msg.senderId !== undefined) update.senderId = msg.senderId
        if (msg.participant !== undefined) update.participant = msg.participant
        if (msg.timestamp) update.timestamp = msg.timestamp
        if (msg.messageType !== 'unknown') update.messageType = msg.messageType

        let finalContent = msg.content
        const existingJson = existingContentMap.get(msg.id)
        if (existingJson) {
          try {
            const existingParsed = JSON.parse(existingJson)
            const existingUnwrapped = unwrapMessage(existingParsed)
            const existingMedia = (
              existingUnwrapped?.imageMessage ??
              existingUnwrapped?.stickerMessage ??
              existingUnwrapped?.videoMessage ??
              existingUnwrapped?.documentMessage ??
              existingUnwrapped?.audioMessage
            ) as MediaMessageWithLocalUri | undefined
            if (existingMedia?.localURI) {
              const currentParsed = JSON.parse(msg.content)
              const currentUnwrapped = unwrapMessage(currentParsed)
              const currentMedia = (
                currentUnwrapped?.imageMessage ??
                currentUnwrapped?.stickerMessage ??
                currentUnwrapped?.videoMessage ??
                currentUnwrapped?.documentMessage ??
                currentUnwrapped?.audioMessage
              ) as MediaMessageWithLocalUri | undefined
              if (currentMedia) {
                currentMedia.localURI = existingMedia.localURI
                finalContent = JSON.stringify(currentParsed)
              }
            }
          } catch (e: unknown) {
            console.error('[MessageRepository] Failed to preserve localURI during sync:', e)
          }
        }
        update.content = finalContent
        if (msg.textContent !== null) update.textContent = msg.textContent
        update.fromMe = msg.fromMe
        if (msg.isEdited !== undefined) update.isEdited = msg.isEdited
        if (msg.isDeleted !== undefined) update.isDeleted = msg.isDeleted

        return this.prisma.message.update({ where: { id: msg.id }, data: update })
      })
      await this.prisma
        .$transaction(updateOps)
        .catch((err: unknown) =>
          console.error('[MessageRepository] bulkSyncMessages update transaction failed:', err)
        )
    }
  }

  /**
   * Deduplicate, validate, and bulk-upsert a set of pending reaction records.
   *
   * Only inserts reactions whose target message IDs exist either in the
   * current batch (`currentBatchIds`) or already in the database.
   *
   * Used exclusively by SyncMessagesHandler during history sync.
   */
  async bulkSyncReactions(
    pendingReactions: Array<{ targetId: string; reactorId: number; emoji: string; timestamp: bigint }>,
    _currentBatchIds: Set<string>
  ): Promise<void> {
    if (pendingReactions.length === 0) return

    // Keep only the latest reaction per (targetId, reactorId)
    const uniqueMap = new Map<string, { targetId: string; reactorId: number; emoji: string; timestamp: bigint }>()
    for (const r of pendingReactions) {
      const key = `${r.targetId}_${r.reactorId}`
      const existing = uniqueMap.get(key)
      if (!existing || r.timestamp > existing.timestamp) {
        uniqueMap.set(key, r)
      }
    }
    const unique = Array.from(uniqueMap.values())

    // Verify target message IDs exist in the DB
    const allTargetIds = Array.from(new Set(unique.map(r => r.targetId)))
    const existingMessageIds = new Set<string>()
    if (allTargetIds.length > 0) {
      const found = await this.prisma.message.findMany({
        where: { id: { in: allTargetIds } },
        select: { id: true }
      })
      for (const m of found) existingMessageIds.add(m.id)
    }

    // Verify reactor identity IDs exist in the DB
    const allReactorIds = Array.from(new Set(unique.map(r => r.reactorId)))
    const existingReactorIds = new Set<number>()
    if (allReactorIds.length > 0) {
      const foundIdentities = await this.prisma.identity.findMany({
        where: { id: { in: allReactorIds } },
        select: { id: true }
      })
      for (const ident of foundIdentities) existingReactorIds.add(ident.id)
    }

    const valid = unique.filter(
      r => existingMessageIds.has(r.targetId) && existingReactorIds.has(r.reactorId)
    )
    if (valid.length === 0) return

    const ops = valid.map(r =>
      this.prisma.reaction.upsert({
        where: { messageId_senderId: { messageId: r.targetId, senderId: r.reactorId } },
        update: { text: r.emoji, timestamp: r.timestamp },
        create: { messageId: r.targetId, senderId: r.reactorId, text: r.emoji, timestamp: r.timestamp }
      })
    )
    await this.prisma.$transaction(ops).catch(async (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[MessageRepository] bulkSyncReactions transaction failed, falling back:', msg)
      for (const r of valid) {
        await this.prisma.reaction
          .upsert({
            where: { messageId_senderId: { messageId: r.targetId, senderId: r.reactorId } },
            update: { text: r.emoji, timestamp: r.timestamp },
            create: { messageId: r.targetId, senderId: r.reactorId, text: r.emoji, timestamp: r.timestamp }
          })
          .catch((opErr: unknown) => {
            const opMsg = opErr instanceof Error ? opErr.message : String(opErr)
            console.error(`[MessageRepository] Failed to upsert reaction for ${r.targetId}:`, opMsg)
          })
      }
    })
  }

  /**
   * Performs the native vector MATCH query against the vec_messages table.
   */
  async searchVectorMatch(
    queryVectorJson: string,
    candidateIds?: string[]
  ): Promise<Array<{ messageId: string; distance: number }>> {
    let filterSql = ''
    const params: any[] = [queryVectorJson]

    if (candidateIds && candidateIds.length > 0) {
      if (candidateIds.length < 2000) {
        filterSql = `AND messageId IN (${candidateIds.map(() => '?').join(',')})`
        params.push(...candidateIds)
      }
    }

    const sql = `
      SELECT messageId, distance
      FROM vec_messages
      WHERE vector MATCH ?
      ${filterSql}
      AND k = 30
      ORDER BY distance ASC
    `
    return this.prisma.$queryRawUnsafe<Array<{ messageId: string; distance: number }>>(sql, ...params)
  }

  /**
   * Fetch the most recent message for preview in a chat.
   */
  async findLastMessage(chatJid: string): Promise<any> {
    return this.prisma.message.findFirst({
      where: { chatJid },
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        textContent: true,
        messageType: true,
        timestamp: true,
        fromMe: true,
        participant: true,
        status: true,
        sender: {
          select: {
            displayName: true,
            pushName: true,
            verifiedName: true,
            phoneNumber: true
          }
        }
      }
    })
  }

  /**
   * Fetch the most recent reaction for a chat.
   */
  async findLastReaction(chatJid: string): Promise<any> {
    return this.prisma.reaction.findFirst({
      where: {
        message: {
          chatJid
        }
      },
      orderBy: { timestamp: 'desc' },
      select: {
        text: true,
        timestamp: true,
        sender: {
          select: {
            displayName: true,
            pushName: true,
            verifiedName: true,
            phoneNumber: true,
            isMe: true
          }
        },
        message: {
          select: {
            id: true,
            messageType: true,
            textContent: true
          }
        }
      }
    })
  }

  /**
   * Batch-find multiple messages with chat and sender details.
   */
  async findMessagesByIdsWithChatAndSender(ids: string[]): Promise<any[]> {
    if (ids.length === 0) return []
    return this.prisma.message.findMany({
      where: { id: { in: ids } },
      include: { chat: true, sender: true }
    })
  }

  /**
   * Find only the message IDs matching a where clause.
   */
  async findMessageIdsOnly(where: any): Promise<string[]> {
    const rows = await this.prisma.message.findMany({
      where,
      select: { id: true }
    })
    return rows.map(r => r.id)
  }

  /**
   * Find messages matching a where clause, with chat and sender details.
   */
  async findMessagesWithChatAndSender(where: any, take?: number): Promise<any[]> {
    return this.prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take,
      include: { chat: true, sender: true }
    })
  }

  /**
   * Find messages in a chat, ordered descending by timestamp.
   */
  async findMessagesByChat(chatJid: string, limit: number): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { chatJid },
      orderBy: { timestamp: 'desc' },
      take: limit
    })
  }

  /**
   * Executes a read-only query and returns the matching message ID rows.
   */
  async queryMessageIdsBySql(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params)
  }

  /**
   * Batch-find multiple messages by their IDs.
   */
  async findMessagesByIds(ids: string[]): Promise<Message[]> {
    if (ids.length === 0) return []
    return this.prisma.message.findMany({
      where: { id: { in: ids } }
    })
  }
}

