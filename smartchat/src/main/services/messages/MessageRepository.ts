import { PrismaClient, Message } from '@prisma/client'
import { unwrapMessage } from '../../utils'
import { MediaMessageWithLocalUri } from '../../types'
import { IMessageRepository, MessageUpsertData } from './IMessageRepository'

/**
 * MessageRepository — Single Responsibility: all Prisma/database write/mutation
 * operations related to the `Message` table.
 */
export class MessageRepository implements IMessageRepository {
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
  ): Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null> {
    return this.prisma.message.update({
      where: { id },
      data: { textContent, content, isEdited: true },
      include: { sender: true }
    }) as Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null>
  }

  /**
   * Update a message's content and return the updated row with sender.
   * Used by MediaService after caching a downloaded media file.
   */
  async updateContentAndFetchWithSender(
    id: string,
    content: string
  ): Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null> {
    return this.prisma.message.update({
      where: { id },
      data: { content },
      include: { sender: true }
    }) as Promise<(Message & { sender: import('@prisma/client').Identity | null }) | null>
  }
}
