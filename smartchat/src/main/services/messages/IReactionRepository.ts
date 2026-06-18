export interface LastReactionInfo {
  text: string
  timestamp: bigint
  sender: {
    displayName: string | null
    pushName: string | null
    verifiedName: string | null
    phoneNumber: string | null
    isMe: boolean
  }
  message: {
    id: string
    messageType: string
    textContent: string | null
  }
}

export interface ReactionSyncData {
  targetId: string
  reactorId: number
  emoji: string
  timestamp: bigint
}

export interface IReactionRepository {
  upsertReaction(
    messageId: string,
    reactorId: number,
    emoji: string | null,
    timestamp: bigint
  ): Promise<void>

  deleteReactions(messageId: string, senderId: number): Promise<void>

  findReactionsForMessages(messageIds: string[]): Promise<Array<{
    messageId: string
    text: string
    timestamp: bigint
    senderId: number
    sender: { displayName: string | null; pushName: string | null; phoneNumber: string | null }
  }>>

  bulkSyncReactions(
    pendingReactions: ReactionSyncData[],
    currentBatchIds: Set<string>
  ): Promise<void>

  findLastReaction(chatJid: string): Promise<LastReactionInfo | null>
}
