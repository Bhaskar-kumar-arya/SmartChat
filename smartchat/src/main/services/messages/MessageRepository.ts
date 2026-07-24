import { PrismaClient } from '@prisma/client'
import { preserveContextInfo, preserveLocalUri, extractContextInfoFromContent } from '../../utils/messageUtils'
import { IMessageRepository, MessageUpsertData } from './IMessageRepository'
import { DBMessageWithSender } from '../../domain/db.types'

/**
 * MessageRepository — Single Responsibility: all Prisma/database write/mutation
 * operations related to the `Message` table.
 */
export class MessageRepository implements IMessageRepository {
  constructor(private readonly prisma: PrismaClient) { }

  /**
   * Upsert a single message into the database.
   * Preserves any `localURI` and `contextInfo` previously saved on message content.
   */
  async upsertMessage(data: MessageUpsertData): Promise<{ content: string; messageType: string; textContent: string | null }> {
    let contentToStore = data.content
    let messageType = data.messageType
    let textContent = data.textContent

    // Preserve existing content, messageType, and textContent if incoming is empty/unknown
    const existing = await this.prisma.message.findUnique({
      where: { id: data.id },
      select: { content: true, messageType: true, textContent: true }
    })

    if (existing) {
      const isNewContentEmpty = !data.content || data.content === '{}'
      const isNewTypeUnknown = data.messageType === 'unknown'

      if (isNewContentEmpty && existing.content && existing.content !== '{}') {
        contentToStore = existing.content
      }
      if (isNewTypeUnknown && existing.messageType && existing.messageType !== 'unknown') {
        messageType = existing.messageType
      }
      if (!textContent && existing.textContent) {
        textContent = existing.textContent
      }
    }

    if (existing?.content && contentToStore) {
      contentToStore = preserveContextInfo(existing.content, contentToStore)
      contentToStore = preserveLocalUri(existing.content, contentToStore)
      try {
        const parsed = JSON.parse(contentToStore) as Record<string, unknown>
        if (parsed.extendedTextMessage) {
          messageType = 'extendedTextMessage'
        }
      } catch {
        // non-fatal
      }
    }

    const { id, ...rest } = data
    const saved = await this.prisma.message
      .upsert({
        where: { id },
        update: {
          textContent,
          messageType,
          content: contentToStore,
          timestamp: rest.timestamp,
          senderId: rest.senderId,
          participant: rest.participant,
          status: rest.status,
          ...(rest.isDeleted ? { isDeleted: true } : {}),
          ...(rest.isEdited !== undefined ? { isEdited: rest.isEdited } : {})
        },
        create: {
          id,
          ...rest,
          messageType,
          textContent,
          content: contentToStore ?? '{}'
        }
      })
      .catch((err: unknown) => {
        console.error(`[MessageRepository] Failed to upsert message ${id}:`, err)
        return null
      })

    return {
      content: saved ? saved.content : (contentToStore ?? '{}'),
      messageType: saved ? saved.messageType : messageType,
      textContent: saved ? saved.textContent : (textContent ?? null)
    }
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
   * Preserves both the original `messageContextInfo` (E2EE device secret)
   * and `contextInfo` (quoted message / reply context) so that reply metadata is retained.
   */
  async editMessage(
    messageId: string,
    textContent: string | null,
    editedContent: Record<string, unknown> | null
  ): Promise<void> {
    let originalMessageContextInfo: Record<string, unknown> | null = null
    let originalContextInfo: Record<string, unknown> | null = null
    try {
      const existing = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { content: true }
      })
      if (existing?.content) {
        const parsed = JSON.parse(existing.content) as Record<string, unknown>
        originalMessageContextInfo = (parsed.messageContextInfo as Record<string, unknown>) ?? null
        originalContextInfo = extractContextInfoFromContent(parsed)
      }
    } catch {
      // Non-fatal — proceed without preserving context
    }

    const editedContextInfo = extractContextInfoFromContent(editedContent)
    const mergedContextInfo =
      originalContextInfo || editedContextInfo
        ? { ...(originalContextInfo ?? {}), ...(editedContextInfo ?? {}) }
        : null

    let contentToStore: Record<string, unknown>
    let newMessageType: string

    if (mergedContextInfo) {
      const extText = (editedContent?.extendedTextMessage as Record<string, unknown> | undefined) ?? {}
      contentToStore = {
        ...(editedContent ?? {}),
        extendedTextMessage: {
          ...extText,
          text: textContent ?? (extText.text as string | undefined) ?? (editedContent?.conversation as string | undefined) ?? '',
          contextInfo: mergedContextInfo
        },
        ...(originalMessageContextInfo ? { messageContextInfo: originalMessageContextInfo } : {})
      }
      delete contentToStore.conversation
      delete contentToStore.editedMessage
      newMessageType = 'extendedTextMessage'
    } else {
      contentToStore = {
        ...(editedContent ?? {}),
        ...(originalMessageContextInfo ? { messageContextInfo: originalMessageContextInfo } : {})
      }
      newMessageType = editedContent?.extendedTextMessage ? 'extendedTextMessage' : 'conversation'
    }

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
   * Updates a message's content and type once it is successfully decrypted.
   */
  async decryptMessage(
    messageId: string,
    messageType: string,
    textContent: string | null,
    content: Record<string, unknown>
  ): Promise<void> {
    // Preserve existing contextInfo when the decrypted payload is an editedMessage
    // wrapper that strips it (e.g. secretEncryptedMessage edit echo from Baileys).
    const existing = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { content: true }
    })
    let contentToStore = JSON.stringify(content)
    if (existing?.content) {
      contentToStore = preserveContextInfo(existing.content, contentToStore)
    }
    await this.prisma.message
      .updateMany({
        where: { id: messageId },
        data: {
          content: contentToStore,
          textContent,
          messageType
        }
      })
      .catch((err: unknown) => {
        console.warn(`[MessageRepository] Failed to update decrypted message ${messageId}:`, err)
      })
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

  private async insertNewMessages(newMessages: MessageUpsertData[]): Promise<void> {
    if (newMessages.length === 0) return
    await this.prisma.message.createMany({ data: newMessages }).catch(async () => {
      const fallbackOps = newMessages.map(m =>
        this.prisma.message.upsert({ where: { id: m.id }, update: m, create: m })
      )
      await this.prisma
        .$transaction(fallbackOps)
        .catch((err: unknown) =>
          console.error('[MessageRepository] insertNewMessages fallback failed:', err)
        )
    })
  }

  private async updateExistingMessages(
    existingMessages: MessageUpsertData[],
    existingContentMap: Map<string, string>
  ): Promise<void> {
    if (existingMessages.length === 0) return

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
        finalContent = preserveContextInfo(existingJson, msg.content)
        finalContent = preserveLocalUri(existingJson, finalContent)
        try {
          const parsed = JSON.parse(finalContent) as Record<string, unknown>
          if (parsed.extendedTextMessage) {
            update.messageType = 'extendedTextMessage'
          }
        } catch {
          // non-fatal
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
        console.error('[MessageRepository] updateExistingMessages transaction failed:', err)
      )
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
      select: { id: true, content: true }
    })
    const existingContentMap = new Map<string, string>()
    for (const row of existingMsgs) {
      if (row.content) existingContentMap.set(row.id, row.content)
    }

    const newMessages = rows.filter(m => !existingContentMap.has(m.id))
    const existingMessages = rows.filter(m => existingContentMap.has(m.id))

    await this.insertNewMessages(newMessages)
    await this.updateExistingMessages(existingMessages, existingContentMap)
  }

  /**
   * Mark a message as deleted (isDeleted = true) by ID.
   */
  async updateMessageDeleted(id: string): Promise<void> {
    await this.prisma.message
      .update({ where: { id }, data: { isDeleted: true } })
      .catch((err: unknown) => {
        console.error(`[MessageRepository] Failed to mark message ${id} as deleted:`, err)
      })
  }

  /**
   * Update a message's text, content, and edited flag, then return the updated row with sender.
   * Used by MessageActionService.editMessage.
   */
  async updateAndFetchMessageWithSender(
    id: string,
    textContent: string,
    content: string
  ): Promise<DBMessageWithSender | null> {
    const existing = await this.prisma.message.findUnique({
      where: { id },
      select: { content: true }
    })
    let finalContent = content
    if (existing?.content) {
      finalContent = preserveContextInfo(existing.content, content)
      finalContent = preserveLocalUri(existing.content, finalContent)
    }
    return this.prisma.message.update({
      where: { id },
      data: { textContent, content: finalContent, isEdited: true },
      include: { sender: true }
    }) as Promise<DBMessageWithSender | null>
  }

  /**
   * Update a message's content and return the updated row with sender.
   * Used by MediaService after caching a downloaded media file.
   */
  async updateContentAndFetchWithSender(
    id: string,
    content: string
  ): Promise<DBMessageWithSender | null> {
    const existing = await this.prisma.message.findUnique({
      where: { id },
      select: { content: true }
    })
    let finalContent = content
    if (existing?.content) {
      finalContent = preserveContextInfo(existing.content, content)
      finalContent = preserveLocalUri(existing.content, finalContent)
    }
    return this.prisma.message.update({
      where: { id },
      data: { content: finalContent },
      include: { sender: true }
    }) as Promise<DBMessageWithSender | null>
  }
}
