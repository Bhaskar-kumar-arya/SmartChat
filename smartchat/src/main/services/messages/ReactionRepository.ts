import { PrismaClient } from '@prisma/client'
import { IReactionRepository, LastReactionInfo, ReactionSyncData } from './IReactionRepository'

export class ReactionRepository implements IReactionRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
          console.error('[ReactionRepository] Failed to delete reaction:', err)
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
        console.error('[ReactionRepository] Failed to upsert reaction:', err)
      })
  }

  /**
   * Delete all reactions from a specific sender on a specific message.
   */
  async deleteReactions(messageId: string, senderId: number): Promise<void> {
    await this.prisma.reaction
      .deleteMany({ where: { messageId, senderId } })
      .catch((err: unknown) => {
        console.error(`[ReactionRepository] Failed to delete reactions for message ${messageId} sender ${senderId}:`, err)
      })
  }

  /**
   * Fetch all reactions for a set of message IDs, including the sender Identity.
   * Used by MessageService.getChatMessages.
   */
  async findReactionsForMessages(messageIds: string[]): Promise<Array<{
    messageId: string
    text: string
    timestamp: bigint
    senderId: number
    sender: { displayName: string | null; pushName: string | null; phoneNumber: string | null }
  }>> {
    if (messageIds.length === 0) return []
    return this.prisma.reaction.findMany({
      where: { messageId: { in: messageIds } },
      include: { sender: true }
    }) as Promise<Array<{
      messageId: string
      text: string
      timestamp: bigint
      senderId: number
      sender: { displayName: string | null; pushName: string | null; phoneNumber: string | null }
    }>>
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
    pendingReactions: ReactionSyncData[],
    _currentBatchIds: Set<string>
  ): Promise<void> {
    if (pendingReactions.length === 0) return

    // Keep only the latest reaction per (targetId, reactorId)
    const uniqueMap = new Map<string, ReactionSyncData>()
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
      console.warn('[ReactionRepository] bulkSyncReactions transaction failed, falling back:', msg)
      for (const r of valid) {
        await this.prisma.reaction
          .upsert({
            where: { messageId_senderId: { messageId: r.targetId, senderId: r.reactorId } },
            update: { text: r.emoji, timestamp: r.timestamp },
            create: { messageId: r.targetId, senderId: r.reactorId, text: r.emoji, timestamp: r.timestamp }
          })
          .catch((opErr: unknown) => {
            const opMsg = opErr instanceof Error ? opErr.message : String(opErr)
            console.error(`[ReactionRepository] Failed to upsert reaction for ${r.targetId}:`, opMsg)
          })
      }
    })
  }

  /**
   * Fetch the most recent reaction for a chat.
   */
  async findLastReaction(chatJid: string): Promise<LastReactionInfo | null> {
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
    }) as Promise<LastReactionInfo | null>
  }
}
